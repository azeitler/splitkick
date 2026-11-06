//! Playwright MCP as a browser engine for agents (issue #104).
//!
//! Engine: [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp).
//! Two modes: its own browser, or the user's logged-in Chrome through the
//! Playwright extension (`--extension`).
//!
//! The backend configs never start `@playwright/mcp` directly. They start
//! Splitkick's own binary with [`LAUNCHER_ARG`]; that launcher reads the
//! extension token from the Keychain and starts `@playwright/mcp` with the
//! token in its environment (`PLAYWRIGHT_MCP_EXTENSION_TOKEN`). So the token
//! is never in a config file and never in a process argument, and it reaches
//! the server even from CLIs that clear the env of MCP servers (Codex).
//!
//! Contract: `docs/developer/browser-for-agents.md`.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::AppHandle;

use super::config::{self, ExistingServer, ServerSpec};
use crate::secret_store::SecretStore;

/// MCP server key written into CLI configs.
pub const MCP_SERVER_NAME: &str = "playwright";
pub const NPM_PACKAGE: &str = "@playwright/mcp";
/// Splitkick-managed npm install directory under app data.
pub const CLI_DIR_NAME: &str = "playwright-mcp-cli";
/// First argument of the launcher mode of the Splitkick binary.
pub const LAUNCHER_ARG: &str = "--splitkick-browser-mcp";
/// `@playwright/mcp` flag for extension mode.
pub const EXTENSION_ARG: &str = "--extension";
/// Env var `@playwright/mcp` reads the extension token from.
pub const TOKEN_ENV: &str = "PLAYWRIGHT_MCP_EXTENSION_TOKEN";
/// Launcher env: Splitkick data dir (Keychain account, managed install).
pub const DATA_DIR_ENV: &str = "SPLITKICK_BROWSER_DATA_DIR";
/// Launcher env: absolute `node` found when the entry was written.
pub const NODE_ENV: &str = "SPLITKICK_BROWSER_NODE";
/// Chrome Web Store page of the Playwright extension.
pub const EXTENSION_URL: &str =
    "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";

const KEYCHAIN_SERVICE: &str = "Splitkick Playwright extension token";
const TOKEN_FILE: &str = "browser-tokens.json";
const TOKEN_ID: &str = "playwright-extension";
/// The server fails after 30 s when the extension does not answer.
const TEST_TIMEOUT: Duration = Duration::from_secs(45);

/// Which browser MCP Splitkick writes into the backends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserEngine {
    Off,
    Playwright,
    PlaywrightExtension,
    /// Default, and the fallback for a value this version does not know.
    #[default]
    #[serde(other)]
    AgentBrowser,
}

impl BrowserEngine {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::AgentBrowser => "agent_browser",
            Self::Playwright => "playwright",
            Self::PlaywrightExtension => "playwright_extension",
        }
    }

    fn is_playwright(self) -> bool {
        matches!(self, Self::Playwright | Self::PlaywrightExtension)
    }
}

// ---------------------------------------------------------------------------
// Entries and duplicate detection
// ---------------------------------------------------------------------------

/// The `playwright` entry: the Splitkick launcher, never a secret.
pub fn playwright_spec(
    launcher: &str,
    data_dir: &Path,
    node: Option<&str>,
    extension: bool,
) -> ServerSpec {
    let mut args = vec![LAUNCHER_ARG.to_string()];
    if extension {
        args.push(EXTENSION_ARG.to_string());
    }
    let mut env = vec![(DATA_DIR_ENV.to_string(), data_dir.display().to_string())];
    if let Some(node) = node.filter(|n| !n.is_empty()) {
        env.push((NODE_ENV.to_string(), node.to_string()));
    }
    ServerSpec {
        name: MCP_SERVER_NAME.to_string(),
        command: launcher.to_string(),
        args,
        env,
    }
}

/// Whether Splitkick wrote this entry.
pub fn is_splitkick_entry(server: &ExistingServer) -> bool {
    server.args.iter().any(|a| a == LAUNCHER_ARG)
}

/// A Playwright MCP server the user set up by hand: named `playwright`, or
/// started from the `@playwright/mcp` package under any name.
pub fn is_hand_made_playwright(server: &ExistingServer) -> bool {
    if is_splitkick_entry(server) {
        return false;
    }
    let mentions = |s: &str| s.contains("@playwright/mcp") || s.contains("playwright-mcp");
    server.name == MCP_SERVER_NAME
        || mentions(&server.command)
        || server.args.iter().any(|a| mentions(a))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandMadeServer {
    pub backend: String,
    pub server_name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineApplyResult {
    pub backend: String,
    /// `installed`, `removed`, `unchanged`, `conflict` or `error`.
    pub status: String,
    pub path: Option<String>,
    pub backup_path: Option<String>,
    pub server_name: Option<String>,
    /// Hand-made Playwright servers that block the write (`conflict`).
    pub conflicts: Vec<String>,
    pub message: String,
}

/// Write `engine` into one backend's config.
///
/// Removes the other engine's Splitkick entry. A hand-made Playwright server
/// blocks a Playwright engine (`conflict`) unless `take_over` is set; then it
/// is removed (the backup keeps it) and the Splitkick entry replaces it.
pub fn apply_engine_to_target(
    backend: &str,
    target: &config::ConfigTarget,
    engine: BrowserEngine,
    playwright: &ServerSpec,
    agent_browser: Option<&ServerSpec>,
    take_over: bool,
) -> EngineApplyResult {
    let result = |status: &str, message: String| EngineApplyResult {
        backend: backend.to_string(),
        status: status.to_string(),
        path: Some(target.path.display().to_string()),
        backup_path: None,
        server_name: None,
        conflicts: Vec::new(),
        message,
    };
    let servers = match config::list_servers(target) {
        Ok(servers) => servers,
        Err(error) => return result("error", error),
    };
    let ours = servers
        .iter()
        .any(|s| s.name == MCP_SERVER_NAME && is_splitkick_entry(s));
    let hand_made: Vec<String> = servers
        .iter()
        .filter(|s| is_hand_made_playwright(s))
        .map(|s| s.name.clone())
        .collect();

    let mut remove = Vec::new();
    if ours {
        remove.push(MCP_SERVER_NAME.to_string());
    }
    if engine != BrowserEngine::AgentBrowser {
        remove.push(super::MCP_SERVER_NAME.to_string());
    }
    let insert = match engine {
        BrowserEngine::Off => None,
        BrowserEngine::AgentBrowser => agent_browser,
        BrowserEngine::Playwright | BrowserEngine::PlaywrightExtension => {
            if !hand_made.is_empty() {
                if !take_over {
                    let mut conflict = result(
                        "conflict",
                        format!(
                            "Already has a Playwright server you set up ({}). Take it over to replace it.",
                            hand_made.join(", ")
                        ),
                    );
                    conflict.conflicts = hand_made;
                    return conflict;
                }
                remove.extend(hand_made.iter().cloned());
            }
            Some(playwright)
        }
    };

    match config::edit_servers(target, &remove, insert) {
        Ok((path, backup)) => {
            let (status, message) = match insert {
                Some(spec) => ("installed", format!("Uses {}", spec.name)),
                None if backup.is_some() => ("removed", "Browser server removed".to_string()),
                None => ("unchanged", "Nothing to change".to_string()),
            };
            EngineApplyResult {
                backend: backend.to_string(),
                status: status.to_string(),
                path: Some(path.display().to_string()),
                backup_path: backup.map(|p| p.display().to_string()),
                server_name: insert.map(|s| s.name.clone()),
                conflicts: Vec::new(),
                message,
            }
        }
        Err(error) => result("error", error),
    }
}

/// Hand-made Playwright servers in every backend config under `home`.
pub fn find_hand_made(home: &Path) -> Vec<HandMadeServer> {
    let mut found = Vec::new();
    for backend in config::BACKENDS {
        let Ok(target) = config::backend_config(home, backend) else {
            continue;
        };
        let Ok(servers) = config::list_servers(&target) else {
            continue;
        };
        for server in servers.iter().filter(|s| is_hand_made_playwright(s)) {
            found.push(HandMadeServer {
                backend: backend.to_string(),
                server_name: server.name.clone(),
                path: target.path.display().to_string(),
            });
        }
    }
    found
}

/// Backends whose config holds the Splitkick `playwright` entry.
fn backends_with_our_entry(home: &Path) -> Vec<String> {
    config::BACKENDS
        .iter()
        .filter(|backend| {
            config::backend_config(home, backend)
                .and_then(|t| config::list_servers(&t))
                .is_ok_and(|servers| {
                    servers
                        .iter()
                        .any(|s| s.name == MCP_SERVER_NAME && is_splitkick_entry(s))
                })
        })
        .map(|b| b.to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

fn token_store(data_dir: &Path) -> SecretStore {
    SecretStore::for_dir(data_dir, KEYCHAIN_SERVICE, TOKEN_FILE)
}

pub fn read_token(data_dir: &Path) -> Result<Option<String>, String> {
    Ok(token_store(data_dir)
        .get(TOKEN_ID)?
        .filter(|t| !t.trim().is_empty()))
}

/// Store the token; an empty token removes it.
pub fn write_token(data_dir: &Path, token: &str) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        token_store(data_dir).delete(TOKEN_ID)
    } else {
        token_store(data_dir).set(TOKEN_ID, token)
    }
}

// ---------------------------------------------------------------------------
// Launching @playwright/mcp
// ---------------------------------------------------------------------------

fn managed_cli_dir_in(data_dir: &Path) -> PathBuf {
    data_dir.join(CLI_DIR_NAME)
}

fn managed_package_dir(data_dir: &Path) -> PathBuf {
    managed_cli_dir_in(data_dir)
        .join("node_modules")
        .join("@playwright")
        .join("mcp")
}

fn managed_version(data_dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(managed_package_dir(data_dir).join("package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value.get("version")?.as_str().map(str::to_string)
}

/// The command that starts `@playwright/mcp`: the managed install when it
/// exists, else `npx -y @playwright/mcp@latest`. `node`'s directory goes first
/// on `PATH`, so `#!/usr/bin/env node` scripts find the same Node.
pub fn server_command(data_dir: &Path, node: Option<&str>) -> Command {
    let node = node.filter(|n| !n.is_empty()).unwrap_or("node");
    let node_dir = Path::new(node)
        .parent()
        .filter(|d| !d.as_os_str().is_empty());
    let script = managed_package_dir(data_dir).join("cli.js");
    let mut cmd = if script.is_file() {
        let mut cmd = crate::platform::silent_command(node);
        cmd.arg(script);
        cmd
    } else {
        let npx_name = if cfg!(windows) { "npx.cmd" } else { "npx" };
        let npx = node_dir
            .map(|d| d.join(npx_name))
            .filter(|p| p.is_file())
            .map(|p| p.into_os_string())
            .unwrap_or_else(|| npx_name.into());
        let mut cmd = crate::platform::silent_command(npx);
        cmd.args(["-y", &format!("{NPM_PACKAGE}@latest")]);
        cmd
    };
    if let Some(dir) = node_dir {
        let mut paths = vec![dir.to_path_buf()];
        if let Some(existing) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&existing));
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }
    }
    cmd
}

/// Launcher mode: `splitkick --splitkick-browser-mcp [playwright-mcp args]`.
///
/// Started by a CLI backend as its stdio MCP server. Reads the token from the
/// Keychain (extension mode) and replaces itself with `@playwright/mcp`; the
/// token goes into the child's environment only.
pub fn run_launcher_from_args() -> Result<(), String> {
    let args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| a != LAUNCHER_ARG)
        .collect();
    let data_dir = std::env::var_os(DATA_DIR_ENV)
        .map(PathBuf::from)
        .ok_or_else(|| format!("{DATA_DIR_ENV} is not set"))?;
    let node = std::env::var(NODE_ENV).ok();
    let mut cmd = server_command(&data_dir, node.as_deref());
    cmd.args(&args);
    if args.iter().any(|a| a == EXTENSION_ARG) {
        match read_token(&data_dir) {
            Ok(Some(token)) => {
                cmd.env(TOKEN_ENV, token);
            }
            Ok(None) => eprintln!(
                "Splitkick: no Playwright extension token saved; the extension asks to approve the connection."
            ),
            Err(error) => eprintln!("Splitkick: cannot read the Playwright extension token: {error}"),
        }
    }
    cmd.stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let error = cmd.exec();
        Err(format!("Failed to start Playwright MCP: {error}"))
    }
    #[cfg(not(unix))]
    {
        let status = cmd
            .status()
            .map_err(|e| format!("Failed to start Playwright MCP: {e}"))?;
        std::process::exit(status.code().unwrap_or(1));
    }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

/// Start the server like an agent would and list the browser tabs. In
/// extension mode this connects to the user's Chrome through the extension.
pub fn test_connection_with(mut cmd: Command, token: Option<&str>) -> Result<String, String> {
    if let Some(token) = token {
        cmd.env(TOKEN_ENV, token);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start Playwright MCP: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("No stdin for Playwright MCP")?;
    let stdout = child.stdout.take().ok_or("No stdout for Playwright MCP")?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if message.get("id").and_then(|v| v.as_i64()) == Some(2) {
                let _ = tx.send(tool_result_text(&message));
                return;
            }
        }
        let _ = tx.send(Err("Playwright MCP stopped before it answered".to_string()));
    });

    let requests = [
        serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "splitkick-connection-test", "version": "1"}}}),
        serde_json::json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        serde_json::json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
            "name": "browser_tabs", "arguments": {"action": "list"}}}),
    ];
    let mut write_error = None;
    for request in requests {
        if let Err(e) = writeln!(stdin, "{request}") {
            write_error = Some(format!("Failed to talk to Playwright MCP: {e}"));
            break;
        }
    }
    let outcome = match write_error {
        Some(error) => Err(error),
        None => rx
            .recv_timeout(TEST_TIMEOUT)
            .unwrap_or_else(|_| Err("No answer from Playwright MCP in time".to_string())),
    };
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    outcome
}

/// The text of a `tools/call` response; `Err` for an error or `isError`.
fn tool_result_text(message: &serde_json::Value) -> Result<String, String> {
    if let Some(error) = message.get("error") {
        return Err(error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Playwright MCP returned an error")
            .to_string());
    }
    let result = message.get("result").cloned().unwrap_or_default();
    let text = result
        .get("content")
        .and_then(|c| c.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
        Err(if text.is_empty() {
            "Playwright MCP could not reach the browser".to_string()
        } else {
            text
        })
    } else {
        Ok(text)
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Home directory unavailable".to_string())
}

fn node_path() -> Option<String> {
    crate::platform::detect_cli_in_path("node", None, None)
        .path
        .filter(|p| !p.is_empty())
}

/// What the Settings UI shows. Never holds the token, so Web Access may read it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEngineStatus {
    pub engine: BrowserEngine,
    pub has_token: bool,
    pub managed_install: bool,
    pub managed_version: Option<String>,
    pub node_path: Option<String>,
    pub extension_url: String,
    /// Backends that hold the Splitkick `playwright` entry.
    pub installed_backends: Vec<String>,
    /// Playwright servers the user set up by hand.
    pub hand_made: Vec<HandMadeServer>,
}

pub async fn get_browser_engine_status(app: AppHandle) -> Result<BrowserEngineStatus, String> {
    let dir = data_dir(&app)?;
    let home = home_dir()?;
    let engine = crate::load_preferences_sync(&app)
        .map(|p| p.browser_engine)
        .unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        Ok(BrowserEngineStatus {
            engine,
            has_token: read_token(&dir)
                .unwrap_or_else(|e| {
                    log::warn!("Cannot read the Playwright extension token: {e}");
                    None
                })
                .is_some(),
            managed_install: managed_package_dir(&dir).join("cli.js").is_file(),
            managed_version: managed_version(&dir),
            node_path: node_path(),
            extension_url: EXTENSION_URL.to_string(),
            installed_backends: backends_with_our_entry(&home),
            hand_made: find_hand_made(&home),
        })
    })
    .await
    .map_err(|e| format!("Failed to read the browser engine status: {e}"))?
}

/// Choose the engine and write it into `backends` (default: all).
/// Desktop IPC only (Web Access shows the setting read-only).
pub async fn set_browser_engine(
    app: AppHandle,
    engine: BrowserEngine,
    backends: Option<Vec<String>>,
    take_over: bool,
) -> Result<Vec<EngineApplyResult>, String> {
    let dir = data_dir(&app)?;
    let home = home_dir()?;
    let backends =
        backends.unwrap_or_else(|| config::BACKENDS.iter().map(|b| b.to_string()).collect());
    // Agent Browser is written only once its binary is installed; until then
    // choosing it just removes the Playwright entry.
    let agent_browser = if engine == BrowserEngine::AgentBrowser
        && super::resolve_agent_browser_binary(&app).installed
    {
        Some(super::build_entry(&app)?)
    } else {
        None
    };
    let app_for_prefs = app.clone();
    let results = tokio::task::spawn_blocking(move || {
        let launcher = crate::jean_mcp_config::get_stable_launcher_command();
        let playwright = playwright_spec(
            &launcher,
            &dir,
            node_path().as_deref(),
            engine == BrowserEngine::PlaywrightExtension,
        );
        backends
            .iter()
            .map(|backend| match config::backend_config(&home, backend) {
                Ok(target) => apply_engine_to_target(
                    backend,
                    &target,
                    engine,
                    &playwright,
                    agent_browser.as_ref(),
                    take_over,
                ),
                Err(message) => EngineApplyResult {
                    backend: backend.clone(),
                    status: "error".to_string(),
                    path: None,
                    backup_path: None,
                    server_name: None,
                    conflicts: Vec::new(),
                    message,
                },
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| format!("Failed to write the browser engine: {e}"))?;

    let installed: Vec<String> = results
        .iter()
        .filter(|r| r.status == "installed")
        .map(|r| r.backend.clone())
        .collect();
    let server_name = if engine.is_playwright() {
        MCP_SERVER_NAME
    } else {
        super::MCP_SERVER_NAME
    };
    if let Err(e) = super::enable_in_preferences(
        &app_for_prefs,
        server_name,
        &installed,
        Some(engine.as_str()),
    ) {
        log::warn!("Failed to save the browser engine in preferences: {e}");
    }
    Ok(results)
}

/// Save (or, with an empty token, remove) the extension token.
/// Desktop IPC only: the token goes in, never out.
pub async fn save_browser_extension_token(app: AppHandle, token: String) -> Result<bool, String> {
    let dir = data_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        write_token(&dir, &token)?;
        Ok(read_token(&dir)?.is_some())
    })
    .await
    .map_err(|e| format!("Failed to save the token: {e}"))?
}

/// Test a Playwright engine. `token` (not yet saved) wins over the stored one.
/// Desktop IPC only.
pub async fn test_browser_connection(
    app: AppHandle,
    extension: bool,
    token: Option<String>,
) -> Result<String, String> {
    let dir = data_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        let token = match token.filter(|t| !t.trim().is_empty()) {
            Some(token) => Some(token.trim().to_string()),
            None if extension => Some(read_token(&dir)?.ok_or(
                "Save the connection token first. Without it the extension waits for you to approve the connection.",
            )?),
            None => None,
        };
        let mut cmd = server_command(&dir, node_path().as_deref());
        if extension {
            cmd.arg(EXTENSION_ARG);
        }
        test_connection_with(cmd, token.as_deref().filter(|_| extension))
    })
    .await
    .map_err(|e| format!("Connection test failed: {e}"))?
}

/// Install `@playwright/mcp` into Splitkick's data (faster start than npx).
pub async fn install_playwright_mcp(app: AppHandle) -> Result<BrowserEngineStatus, String> {
    let dir = data_dir(&app)?;
    let cli_dir = managed_cli_dir_in(&dir);
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&cli_dir)
            .map_err(|e| format!("Failed to create {}: {e}", cli_dir.display()))?;
        let npm = crate::prerequisites::require_npm("Playwright MCP")?;
        let output = crate::platform::host_cli_command(&npm, None)
            .args(["install", "--prefix"])
            .arg(&cli_dir)
            .arg(NPM_PACKAGE)
            .output()
            .map_err(|e| format!("Failed to run npm install: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("npm install {NPM_PACKAGE} failed: {stderr}"));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Install failed: {e}"))??;
    get_browser_engine_status(app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs;
    use tempfile::TempDir;

    const FAKE_TOKEN: &str = "fake-token-104-do-not-use";

    fn our_spec(dir: &Path, extension: bool) -> ServerSpec {
        playwright_spec(
            "/Applications/Splitkick.app/Contents/MacOS/splitkick",
            dir,
            Some("/opt/node/bin/node"),
            extension,
        )
    }

    fn agent_browser_spec() -> ServerSpec {
        super::super::agent_browser_spec("/bin/agent-browser".into(), "/p".into())
    }

    fn apply(home: &Path, engine: BrowserEngine, take_over: bool) -> Vec<EngineApplyResult> {
        let pw = our_spec(home, engine == BrowserEngine::PlaywrightExtension);
        let ab = agent_browser_spec();
        config::BACKENDS
            .iter()
            .map(|b| {
                let target = config::backend_config(home, b).unwrap();
                apply_engine_to_target(b, &target, engine, &pw, Some(&ab), take_over)
            })
            .collect()
    }

    fn servers(home: &Path, backend: &str) -> Vec<ExistingServer> {
        config::list_servers(&config::backend_config(home, backend).unwrap()).unwrap()
    }

    fn all_config_text(home: &Path) -> String {
        config::BACKENDS
            .iter()
            .filter_map(|b| fs::read_to_string(config::backend_config(home, b).unwrap().path).ok())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn extension_engine_writes_the_launcher_for_every_backend() {
        let home = TempDir::new().unwrap();
        let results = apply(home.path(), BrowserEngine::PlaywrightExtension, false);
        assert!(
            results.iter().all(|r| r.status == "installed"),
            "{results:?}"
        );
        for backend in config::BACKENDS {
            let list = servers(home.path(), backend);
            let pw = list.iter().find(|s| s.name == "playwright").unwrap();
            assert_eq!(pw.args, vec![LAUNCHER_ARG, EXTENSION_ARG], "{backend}");
            assert!(pw.command.ends_with("splitkick"), "{backend}");
        }
        // Codex/Grok TOML carries the non-secret launcher env.
        let codex = fs::read_to_string(home.path().join(".codex/config.toml")).unwrap();
        assert!(codex.contains(DATA_DIR_ENV));
        assert!(codex.contains(NODE_ENV));
        // OpenCode keeps its own shape.
        let opencode: Value = serde_json::from_str(
            &fs::read_to_string(home.path().join(".config/opencode/opencode.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(opencode["mcp"]["playwright"]["type"], "local");
        assert_eq!(opencode["mcp"]["playwright"]["command"][1], LAUNCHER_ARG);
    }

    #[test]
    fn own_browser_engine_has_no_extension_flag() {
        let home = TempDir::new().unwrap();
        apply(home.path(), BrowserEngine::Playwright, false);
        let pw = servers(home.path(), "claude")
            .into_iter()
            .find(|s| s.name == "playwright")
            .unwrap();
        assert_eq!(pw.args, vec![LAUNCHER_ARG]);
    }

    #[test]
    fn switching_engines_replaces_the_other_entry() {
        let home = TempDir::new().unwrap();
        apply(home.path(), BrowserEngine::AgentBrowser, false);
        let names: Vec<_> = servers(home.path(), "codex")
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["agent-browser"]);

        apply(home.path(), BrowserEngine::Playwright, false);
        let names: Vec<_> = servers(home.path(), "codex")
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["playwright"]);

        apply(home.path(), BrowserEngine::AgentBrowser, false);
        let names: Vec<_> = servers(home.path(), "claude")
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["agent-browser"]);

        let results = apply(home.path(), BrowserEngine::Off, false);
        assert!(results.iter().all(|r| r.status == "removed"), "{results:?}");
        for backend in config::BACKENDS {
            assert!(servers(home.path(), backend).is_empty(), "{backend}");
        }
    }

    #[test]
    fn hand_made_playwright_blocks_until_taken_over() {
        let home = TempDir::new().unwrap();
        let claude = home.path().join(".claude.json");
        fs::write(
            &claude,
            r#"{"mcpServers":{
                "browser":{"command":"npx","args":["@playwright/mcp@latest","--extension"],
                           "env":{"PLAYWRIGHT_MCP_EXTENSION_TOKEN":"hand-made"}},
                "other":{"command":"x"}}}"#,
        )
        .unwrap();
        let codex = home.path().join(".codex/config.toml");
        fs::create_dir_all(codex.parent().unwrap()).unwrap();
        fs::write(&codex, "[mcp_servers.playwright]\ncommand = \"npx\"\n").unwrap();

        let found = find_hand_made(home.path());
        assert_eq!(found.len(), 2);
        assert!(found
            .iter()
            .any(|f| f.backend == "claude" && f.server_name == "browser"));
        assert!(found
            .iter()
            .any(|f| f.backend == "codex" && f.server_name == "playwright"));

        let results = apply(home.path(), BrowserEngine::PlaywrightExtension, false);
        let claude_result = results.iter().find(|r| r.backend == "claude").unwrap();
        assert_eq!(claude_result.status, "conflict");
        assert_eq!(claude_result.conflicts, vec!["browser"]);
        // No duplicate: the hand-made one stays, ours is not added.
        let names: Vec<_> = servers(home.path(), "claude")
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["browser", "other"]);
        // Backends without a hand-made server got ours.
        assert_eq!(
            results.iter().find(|r| r.backend == "kimi").unwrap().status,
            "installed"
        );

        let results = apply(home.path(), BrowserEngine::PlaywrightExtension, true);
        let claude_result = results.iter().find(|r| r.backend == "claude").unwrap();
        assert_eq!(claude_result.status, "installed");
        assert!(claude_result.backup_path.is_some());
        let names: Vec<_> = servers(home.path(), "claude")
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["other", "playwright"]);
        assert!(find_hand_made(home.path()).is_empty());
        // Our own entry is never seen as a duplicate.
        let again = apply(home.path(), BrowserEngine::PlaywrightExtension, false);
        assert!(again.iter().all(|r| r.status == "installed"), "{again:?}");
    }

    #[test]
    fn token_never_lands_in_a_config_file_or_entry() {
        let home = TempDir::new().unwrap();
        std::env::set_var(crate::secret_store::TOKEN_STORE_ENV, "file");
        write_token(home.path(), FAKE_TOKEN).unwrap();
        assert_eq!(
            read_token(home.path()).unwrap().as_deref(),
            Some(FAKE_TOKEN)
        );

        apply(home.path(), BrowserEngine::PlaywrightExtension, false);
        assert!(!all_config_text(home.path()).contains(FAKE_TOKEN));
        let spec = our_spec(home.path(), true);
        assert!(!spec.args.iter().any(|a| a.contains(FAKE_TOKEN)));
        assert!(!spec.env.iter().any(|(_, v)| v.contains(FAKE_TOKEN)));

        write_token(home.path(), "  ").unwrap();
        assert_eq!(read_token(home.path()).unwrap(), None);
    }

    #[test]
    fn token_file_store_is_owner_only() {
        let home = TempDir::new().unwrap();
        std::env::set_var(crate::secret_store::TOKEN_STORE_ENV, "file");
        write_token(home.path(), FAKE_TOKEN).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(home.path().join(TOKEN_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    /// A fake `@playwright/mcp`: prints its env token and args as the
    /// `browser_tabs` answer, so the test sees exactly what the server gets.
    #[cfg(unix)]
    fn fake_server(dir: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let script = dir.join("fake-playwright-mcp");
        fs::write(
            &script,
            r#"#!/bin/sh
read init; read note; read call
printf '{"jsonrpc":"2.0","id":1,"result":{}}\n'
printf '{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"token=%s args=%s"}]}}\n' "$PLAYWRIGHT_MCP_EXTENSION_TOKEN" "$*"
"#,
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    #[cfg(unix)]
    #[test]
    fn connection_test_passes_the_token_in_env_not_args() {
        let dir = TempDir::new().unwrap();
        let mut cmd = Command::new(fake_server(dir.path()));
        cmd.arg(EXTENSION_ARG);
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(!args.iter().any(|a| a.contains(FAKE_TOKEN)));

        let text = test_connection_with(cmd, Some(FAKE_TOKEN)).unwrap();
        assert_eq!(text, format!("token={FAKE_TOKEN} args={EXTENSION_ARG}"));
    }

    #[test]
    fn server_command_never_carries_a_token_argument() {
        let dir = TempDir::new().unwrap();
        let cmd = server_command(dir.path(), Some("/opt/node/bin/node"));
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(args, vec!["-y", "@playwright/mcp@latest"]);
        let path = cmd
            .get_envs()
            .find(|(k, _)| *k == "PATH")
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().to_string())
            .unwrap();
        assert!(path.starts_with("/opt/node/bin"));
    }

    #[test]
    fn tool_errors_become_err() {
        let ok = serde_json::json!({"id":2,"result":{"content":[{"type":"text","text":"### Open tabs"}]}});
        assert_eq!(tool_result_text(&ok).unwrap(), "### Open tabs");
        let tool_error = serde_json::json!({"id":2,"result":{"isError":true,"content":[{"type":"text","text":"Extension connection timeout"}]}});
        assert_eq!(
            tool_result_text(&tool_error).unwrap_err(),
            "Extension connection timeout"
        );
        let rpc_error = serde_json::json!({"id":2,"error":{"message":"bad"}});
        assert_eq!(tool_result_text(&rpc_error).unwrap_err(), "bad");
    }

    #[test]
    fn unknown_engine_in_preferences_falls_back_to_agent_browser() {
        let engine: BrowserEngine = serde_json::from_str("\"something_new\"").unwrap();
        assert_eq!(engine, BrowserEngine::AgentBrowser);
        let engine: BrowserEngine = serde_json::from_str("\"playwright_extension\"").unwrap();
        assert_eq!(engine, BrowserEngine::PlaywrightExtension);
    }
}
