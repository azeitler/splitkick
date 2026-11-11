//! Live usage for Claude accounts that are not active (#134).
//!
//! Every run uses the active account (#131), so the other accounts keep an
//! expired OAuth access token, and the usage endpoint needs a valid one. Jean
//! never refreshes a token itself: refresh tokens are single-use, and a refresh
//! by Jean revokes the one every running `claude` process of that account holds.
//! Instead Jean lets the Claude CLI renew it: one tiny `claude -p` request under
//! the account's `CLAUDE_CONFIG_DIR`. The CLI refreshes the token before the API
//! call and writes the new one to the Keychain or `.credentials.json`.
//!
//! Rules: only on demand (the usage popover, the Settings usage pane, Refresh),
//! never for the active account, never while a `claude` process of the account
//! runs, never without a refresh token, at most one attempt per token (keyed by
//! its expiry), and one renew per account at a time.
//!
//! Flags (Claude Code 2.1.322 `claude --help`, https://code.claude.com/docs/en/cli-reference):
//! `--safe-mode` skips CLAUDE.md, hooks, plugins and MCP but keeps OAuth (unlike
//! `--bare`, which never reads the Keychain). Measured on 2026-11-11 with Haiku:
//! 575 input + 6 output tokens, USD 0.00012; the renewed token lives 8 hours.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use super::accounts::ResolvedClaudeAccount;

const RENEW_TIMEOUT: Duration = Duration::from_secs(90);
const RENEW_ARGS: &[&str] = &[
    "-p",
    "ok",
    "--model",
    "haiku",
    "--safe-mode",
    "--tools",
    "",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--max-turns",
    "1",
    "--system-prompt",
    "Reply with one word.",
    "--output-format",
    "json",
];

/// What the caller knows about the account whose token expired.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RenewInputs {
    pub expired: bool,
    pub has_refresh_token: bool,
    pub is_active: bool,
    pub claude_running: bool,
    /// A renew was already tried (or is running) for this exact token expiry.
    pub already_tried: bool,
}

/// `Ok` when the CLI may renew the token, else why not (for the log).
pub(crate) fn renew_decision(inputs: RenewInputs) -> Result<(), &'static str> {
    if !inputs.expired {
        return Err("token still valid");
    }
    if inputs.is_active {
        return Err("active account: its runs renew the token");
    }
    if !inputs.has_refresh_token {
        return Err("not logged in (no refresh token)");
    }
    if inputs.claude_running {
        return Err("a claude process of this account is running");
    }
    if inputs.already_tried {
        return Err("already tried for this token");
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct RenewState {
    /// Expiry (ms) of the token the last attempt was for.
    tried_expires_at: u64,
    running: bool,
}

fn renews() -> &'static Mutex<HashMap<String, RenewState>> {
    static RENEWS: OnceLock<Mutex<HashMap<String, RenewState>>> = OnceLock::new();
    RENEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn account_key(config_dir: Option<&str>) -> String {
    config_dir
        .unwrap_or(super::accounts::ROOT_ACCOUNT_ID)
        .to_string()
}

/// Whether an attempt for this token expiry already started.
pub(crate) fn already_tried(config_dir: Option<&str>, expires_at: u64) -> bool {
    let map = renews().lock().unwrap_or_else(|e| e.into_inner());
    map.get(&account_key(config_dir))
        .is_some_and(|state| state.running || state.tried_expires_at == expires_at)
}

/// Single-flight: claims the renew of this account. False when one runs or this
/// token was already tried.
pub(crate) fn try_begin(config_dir: Option<&str>, expires_at: u64) -> bool {
    let mut map = renews().lock().unwrap_or_else(|e| e.into_inner());
    let key = account_key(config_dir);
    if map
        .get(&key)
        .is_some_and(|state| state.running || state.tried_expires_at == expires_at)
    {
        return false;
    }
    map.insert(
        key,
        RenewState {
            tried_expires_at: expires_at,
            running: true,
        },
    );
    true
}

pub(crate) fn finish(config_dir: Option<&str>) {
    let mut map = renews().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(state) = map.get_mut(&account_key(config_dir)) {
        state.running = false;
    }
}

pub(crate) fn is_renewing(config_dir: Option<&str>) -> bool {
    let map = renews().lock().unwrap_or_else(|e| e.into_inner());
    map.get(&account_key(config_dir))
        .is_some_and(|state| state.running)
}

fn any_renewing() -> bool {
    let map = renews().lock().unwrap_or_else(|e| e.into_inner());
    map.values().any(|state| state.running)
}

/// Waits until no renew runs (at most the renew timeout). The menu bar uses it
/// to show the new figures after its Refresh.
pub async fn claude_usage_renews_settled() {
    let deadline = tokio::time::Instant::now() + RENEW_TIMEOUT + Duration::from_secs(5);
    while any_renewing() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// True when a `claude` process of this config folder runs. Claude Code keeps
/// one `sessions/<pid>.json` per live process (interactive and `-p`) in its
/// config folder and removes it on exit; the pid check skips files a crash left.
pub(crate) fn claude_running(config_path: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(config_path.join("sessions")) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        path.extension().is_some_and(|ext| ext == "json")
            && path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|stem| stem.parse::<u32>().ok())
                .is_some_and(crate::platform::is_process_alive)
    })
}

/// Runs the renew request in the background. The caller already won
/// [`try_begin`]; this always calls [`finish`].
pub(crate) fn spawn_renew(cli_path: PathBuf, account: ResolvedClaudeAccount, work_dir: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let config_dir = account.config_dir.clone();
        match run_renew(&cli_path, &account, &work_dir).await {
            Ok(summary) => log::info!(
                "Claude CLI renewed the token of account {} ({summary})",
                account.id
            ),
            Err(reason) => log::warn!(
                "Could not renew the token of Claude account {}: {reason}",
                account.id
            ),
        }
        finish(config_dir.as_deref());
    });
}

async fn run_renew(
    cli_path: &Path,
    account: &ResolvedClaudeAccount,
    work_dir: &Path,
) -> Result<String, String> {
    // An empty folder outside any repository, so no project files load.
    std::fs::create_dir_all(work_dir).map_err(|e| format!("work folder: {e}"))?;
    let mut cmd = crate::platform::cli_command(&cli_path.to_string_lossy(), Some(work_dir));
    account.apply_env(&mut cmd);
    cmd.args(RENEW_ARGS)
        .current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut cmd = tokio::process::Command::from(cmd);
    cmd.kill_on_drop(true);
    let child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let output = tokio::time::timeout(RENEW_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| format!("timed out after {}s", RENEW_TIMEOUT.as_secs()))?
        .map_err(|e| format!("wait failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: Option<serde_json::Value> = serde_json::from_str(stdout.trim()).ok();
    let is_error = result
        .as_ref()
        .and_then(|v| v.get("is_error")?.as_bool())
        .unwrap_or(true);
    if !output.status.success() || is_error {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = result
            .as_ref()
            .and_then(|v| v.get("result")?.as_str().map(str::to_string))
            .unwrap_or_else(|| stderr.trim().to_string());
        let detail: String = detail.chars().take(300).collect();
        return Err(format!("exit {:?}: {detail}", output.status.code()));
    }
    let cost = result
        .as_ref()
        .and_then(|v| v.get("total_cost_usd")?.as_f64())
        .unwrap_or(0.0);
    let tokens = |key: &str| {
        result
            .as_ref()
            .and_then(|v| v.get("usage")?.get(key)?.as_u64())
            .unwrap_or(0)
    };
    let input = tokens("input_tokens")
        + tokens("cache_creation_input_tokens")
        + tokens("cache_read_input_tokens");
    Ok(format!(
        "{input} input + {} output tokens, USD {cost:.5}",
        tokens("output_tokens")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eligible() -> RenewInputs {
        RenewInputs {
            expired: true,
            has_refresh_token: true,
            is_active: false,
            claude_running: false,
            already_tried: false,
        }
    }

    #[test]
    fn renews_an_expired_idle_account() {
        assert_eq!(renew_decision(eligible()), Ok(()));
    }

    #[test]
    fn never_renews_when_a_rule_says_no() {
        let cases = [
            RenewInputs {
                expired: false,
                ..eligible()
            },
            RenewInputs {
                is_active: true,
                ..eligible()
            },
            RenewInputs {
                claude_running: true,
                ..eligible()
            },
            RenewInputs {
                has_refresh_token: false,
                ..eligible()
            },
            RenewInputs {
                already_tried: true,
                ..eligible()
            },
        ];
        for inputs in cases {
            assert!(renew_decision(inputs).is_err(), "{inputs:?}");
        }
    }

    #[test]
    fn one_renew_per_account_and_token() {
        let dir = Some("/tmp/jean-renew-test-single-flight");
        assert!(try_begin(dir, 1_000));
        assert!(is_renewing(dir));
        // Single-flight: a second caller while it runs, even for a newer token.
        assert!(!try_begin(dir, 1_000));
        assert!(!try_begin(dir, 2_000));
        finish(dir);
        assert!(!is_renewing(dir));
        // Same token again: already tried (a failed renew does not loop).
        assert!(already_tried(dir, 1_000));
        assert!(!try_begin(dir, 1_000));
        // A new token lifetime gets one attempt again.
        assert!(!already_tried(dir, 2_000));
        assert!(try_begin(dir, 2_000));
        finish(dir);
        // Other accounts are independent.
        assert!(try_begin(Some("/tmp/jean-renew-test-other"), 1_000));
        finish(Some("/tmp/jean-renew-test-other"));
    }

    #[test]
    fn detects_a_running_claude_process_by_its_session_file() {
        let dir = std::env::temp_dir().join(format!("jean-renew-running-{}", std::process::id()));
        let sessions = dir.join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        assert!(!claude_running(&dir));
        // A file a crashed process left: pid that does not run.
        std::fs::write(sessions.join("4000000.json"), "{}").unwrap();
        assert!(!claude_running(&dir));
        // This test process is alive.
        std::fs::write(sessions.join(format!("{}.json", std::process::id())), "{}").unwrap();
        assert!(claude_running(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renew_args_hold_no_secret_and_skip_customizations() {
        assert!(RENEW_ARGS.contains(&"--safe-mode"));
        assert!(RENEW_ARGS.contains(&"--no-session-persistence"));
        assert!(!RENEW_ARGS.contains(&"--bare"));
    }
}
