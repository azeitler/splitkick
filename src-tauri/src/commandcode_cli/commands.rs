//! Tauri commands for Command Code CLI management.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::time::Duration;
use tauri::AppHandle;

use super::config::{resolve_cli_binary, CLI_BINARY_CANDIDATES};
use crate::platform::silent_command;

const AUTH_CHECK_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCodeCliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCodeAuthStatus {
    pub authenticated: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub timed_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCodePathDetection {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub package_manager: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCodeInstallCommand {
    pub command: String,
    pub args: Vec<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCodeModelInfo {
    pub id: String,
    pub label: String,
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek().is_some_and(|c| *c == '[') {
                let _ = chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

fn parse_version(stdout: &[u8]) -> Option<String> {
    let version = strip_ansi(&String::from_utf8_lossy(stdout))
        .trim()
        .to_string();
    if version.is_empty() {
        None
    } else {
        Some(version.trim_start_matches('v').to_string())
    }
}

fn looks_authenticated(output: &str) -> bool {
    let lower = output.to_lowercase();
    if lower.contains("not authenticated")
        || lower.contains("not logged in")
        || lower.contains("login required")
    {
        return false;
    }
    lower.contains("authenticated")
        || lower.contains("logged in")
        || lower.contains("signed in")
        || lower.contains("user") && lower.contains('@')
}

fn parse_json_auth_status(output: &str) -> Option<CommandCodeAuthStatus> {
    let value: serde_json::Value = serde_json::from_str(output.trim()).ok()?;
    let authenticated = value
        .get("authenticated")
        .or_else(|| value.get("logged_in"))
        .or_else(|| value.get("loggedIn"))
        .and_then(|v| v.as_bool());
    if let Some(authenticated) = authenticated {
        let error = value
            .get("error")
            .or_else(|| value.get("message"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(ToString::to_string);
        return Some(CommandCodeAuthStatus {
            authenticated,
            error,
            timed_out: false,
        });
    }

    let has_user = value.get("user").is_some()
        || value.get("email").and_then(|v| v.as_str()).is_some()
        || value.get("account").is_some();
    if has_user {
        return Some(CommandCodeAuthStatus {
            authenticated: true,
            error: None,
            timed_out: false,
        });
    }
    None
}

fn is_model_token(token: &str) -> bool {
    let token = token.trim_matches(|c: char| {
        c == '`' || c == '"' || c == '\'' || c == ',' || c == '|' || c == '*'
    });
    if token.is_empty()
        || token.starts_with('-')
        || token.eq_ignore_ascii_case("model")
        || token.eq_ignore_ascii_case("id")
        || token.eq_ignore_ascii_case("name")
        || token.eq_ignore_ascii_case("provider")
        || token.eq_ignore_ascii_case("best")
        || token.eq_ignore_ascii_case("for")
        || token.eq_ignore_ascii_case("default")
        || token == "cmd"
    {
        return false;
    }
    token.contains('/')
        || token.starts_with("claude-")
        || token.starts_with("gpt-")
        || token.starts_with("gemini-")
        || token.to_ascii_lowercase().contains("kimi-")
}

fn label_from_model_id(id: &str) -> String {
    id.rsplit('/')
        .next()
        .unwrap_or(id)
        .replace(['-', '_'], " ")
        .split_whitespace()
        .map(|word| {
            if word.len() <= 3 || word.chars().any(|c| c.is_ascii_digit()) {
                word.to_ascii_uppercase()
            } else {
                let mut chars = word.chars();
                match chars.next() {
                    Some(first) => {
                        first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                    }
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_models_output(output: &str) -> Vec<CommandCodeModelInfo> {
    let mut seen = std::collections::HashSet::new();
    let mut models = Vec::new();
    for raw_line in strip_ansi(output).lines() {
        let line = raw_line
            .trim()
            .trim_start_matches(['|', '-', '*', '•'])
            .trim();
        if line.is_empty() {
            continue;
        }
        let Some(raw_token) = line
            .split(|c: char| c.is_whitespace() || c == '|')
            .find(|token| is_model_token(token))
        else {
            continue;
        };
        let id = raw_token
            .trim_matches(|c: char| {
                c == '`' || c == '"' || c == '\'' || c == ',' || c == '|' || c == '*'
            })
            .to_string();
        if seen.insert(id.to_ascii_lowercase()) {
            models.push(CommandCodeModelInfo {
                label: label_from_model_id(&id),
                id,
            });
        }
    }
    models
}

enum TimedCommandResult {
    Output(Output),
    TimedOut,
}

fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<TimedCommandResult, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn command: {error}"))?;
    let start = std::time::Instant::now();

    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            if let Some(mut handle) = child.stdout.take() {
                let _ = handle.read_to_end(&mut stdout);
            }
            if let Some(mut handle) = child.stderr.take() {
                let _ = handle.read_to_end(&mut stderr);
            }
            return Ok(TimedCommandResult::Output(Output {
                status,
                stdout,
                stderr,
            }));
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(TimedCommandResult::TimedOut);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[tauri::command]
pub async fn check_commandcode_cli_installed(
    app: AppHandle,
) -> Result<CommandCodeCliStatus, String> {
    let binary_path = resolve_cli_binary(&app);
    if !binary_path.exists() {
        return Ok(CommandCodeCliStatus {
            installed: false,
            version: None,
            path: None,
        });
    }
    let version = match silent_command(&binary_path).arg("--version").output() {
        Ok(output) if output.status.success() => parse_version(&output.stdout),
        Ok(output) => {
            log::warn!(
                "Command Code version command failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
            None
        }
        Err(error) => {
            log::warn!("Failed to execute Command Code CLI: {error}");
            None
        }
    };
    Ok(CommandCodeCliStatus {
        installed: true,
        version,
        path: Some(binary_path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn check_commandcode_cli_auth(app: AppHandle) -> Result<CommandCodeAuthStatus, String> {
    let binary_path = resolve_cli_binary(&app);
    if !binary_path.exists() {
        return Ok(CommandCodeAuthStatus {
            authenticated: false,
            error: Some("Command Code CLI not found in PATH".to_string()),
            timed_out: false,
        });
    }

    for args in [
        ["status", "--json"].as_slice(),
        ["status"].as_slice(),
        ["whoami"].as_slice(),
    ] {
        let output = match run_command_with_timeout(
            {
                let mut command = silent_command(&binary_path);
                command.args(args);
                command
            },
            AUTH_CHECK_TIMEOUT,
        ) {
            Ok(TimedCommandResult::Output(output)) => output,
            Ok(TimedCommandResult::TimedOut) => {
                return Ok(CommandCodeAuthStatus {
                    authenticated: false,
                    error: Some(
                        "Command Code auth check timed out. Try again or run `cmd login`."
                            .to_string(),
                    ),
                    timed_out: true,
                })
            }
            Err(error) => {
                log::warn!(
                    "Failed to execute Command Code auth check {:?}: {error}",
                    args
                );
                continue;
            }
        };
        let combined = strip_ansi(&format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
        if let Some(status) = parse_json_auth_status(&combined) {
            return Ok(status);
        }
        if looks_authenticated(&combined) {
            return Ok(CommandCodeAuthStatus {
                authenticated: true,
                error: None,
                timed_out: false,
            });
        }
        if !output.status.success() {
            let msg = combined.trim();
            return Ok(CommandCodeAuthStatus {
                authenticated: false,
                error: Some(if msg.is_empty() {
                    "Not authenticated. Run `cmd login`.".to_string()
                } else {
                    msg.to_string()
                }),
                timed_out: false,
            });
        }
    }
    Ok(CommandCodeAuthStatus {
        authenticated: false,
        error: Some("Not authenticated. Run `cmd login`.".to_string()),
        timed_out: false,
    })
}

#[tauri::command]
pub async fn detect_commandcode_in_path(
    _app: AppHandle,
) -> Result<CommandCodePathDetection, String> {
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    let mut found_path = String::new();
    for binary_name in CLI_BINARY_CANDIDATES {
        found_path = match silent_command(which_cmd).arg(binary_name).output() {
            Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string(),
            _ => String::new(),
        };
        if !found_path.is_empty() {
            break;
        }
    }
    if found_path.is_empty() {
        return Ok(CommandCodePathDetection {
            found: false,
            path: None,
            version: None,
            package_manager: None,
        });
    }
    let version = silent_command(&found_path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                parse_version(&o.stdout)
            } else {
                None
            }
        });
    let package_manager = if found_path.contains("/npm/") || found_path.contains("node_modules") {
        Some("npm".to_string())
    } else {
        None
    };
    Ok(CommandCodePathDetection {
        found: true,
        path: Some(found_path),
        version,
        package_manager,
    })
}

#[tauri::command]
pub async fn list_commandcode_models(app: AppHandle) -> Result<Vec<CommandCodeModelInfo>, String> {
    let binary_path = resolve_cli_binary(&app);
    if !binary_path.exists() {
        return Ok(vec![]);
    }
    let output = run_command_with_timeout(
        {
            let mut command = silent_command(&binary_path);
            command.arg("--list-models");
            command
        },
        Duration::from_secs(10),
    )?;
    let output = match output {
        TimedCommandResult::Output(output) => output,
        TimedCommandResult::TimedOut => {
            log::warn!("Command Code model list timed out");
            return Ok(vec![]);
        }
    };
    if !output.status.success() {
        log::warn!(
            "Command Code --list-models failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return Ok(vec![]);
    }
    Ok(parse_models_output(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

#[tauri::command]
pub async fn get_commandcode_install_command() -> Result<CommandCodeInstallCommand, String> {
    Ok(CommandCodeInstallCommand {
        command: "npm".to_string(),
        args: vec![
            "install".to_string(),
            "-g".to_string(),
            "command-code@latest".to_string(),
        ],
        description: "Install the latest Command Code globally with npm".to_string(),
    })
}
