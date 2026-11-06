//! Several Claude accounts, one Claude config folder each (#90).
//!
//! The root install (`~/.claude`, no `CLAUDE_CONFIG_DIR`) is always there. Every
//! other account is a folder that Claude Code gets as `CLAUDE_CONFIG_DIR` in the
//! process environment. Claude keys the login on that exact string, so Jean
//! normalizes it once when preferences are saved and passes it unchanged
//! everywhere. See `docs/developer/claude-accounts.md`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::AppPreferences;

/// Id of the root install. Recorded on sessions whose runs used it.
pub const ROOT_ACCOUNT_ID: &str = "root";

/// Label of the root install when the user did not set one.
pub const ROOT_ACCOUNT_DEFAULT_LABEL: &str = "Default";

const CLAUDE_CONFIG_DIR_ENV: &str = "CLAUDE_CONFIG_DIR";
const KEYCHAIN_SERVICE_BASE: &str = "Claude Code-credentials";

/// An extra Claude account, as stored in preferences.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaudeAccount {
    pub id: String,
    pub label: String,
    /// Absolute path, normalized on save (`~` expanded, no trailing slash).
    pub config_dir: String,
}

/// An account Jean can run Claude with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedClaudeAccount {
    pub id: String,
    pub label: String,
    /// `None` for the root install: the env is left as it is.
    pub config_dir: Option<String>,
}

impl ResolvedClaudeAccount {
    pub fn is_root(&self) -> bool {
        self.config_dir.is_none()
    }

    /// The env var to set on every Claude process of this account.
    pub fn env(&self) -> Option<(&'static str, String)> {
        self.config_dir
            .as_ref()
            .map(|dir| (CLAUDE_CONFIG_DIR_ENV, dir.clone()))
    }

    /// Set the account on a Claude command. The root install leaves the env alone.
    pub fn apply_env(&self, cmd: &mut std::process::Command) {
        if let Some((key, value)) = self.env() {
            cmd.env(key, value);
        }
    }

    /// The folder Claude keeps this account's transcripts, settings and skills in.
    pub fn config_path(&self) -> Option<PathBuf> {
        match &self.config_dir {
            Some(dir) => Some(PathBuf::from(dir)),
            None => dirs::home_dir().map(|home| home.join(".claude")),
        }
    }
}

fn root_account(prefs: &AppPreferences) -> ResolvedClaudeAccount {
    let label = prefs
        .claude_root_label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .unwrap_or(ROOT_ACCOUNT_DEFAULT_LABEL)
        .to_string();
    ResolvedClaudeAccount {
        id: ROOT_ACCOUNT_ID.to_string(),
        label,
        config_dir: None,
    }
}

/// The account for `id`. `None`, `"root"` and unknown ids (a removed account) give
/// the root install.
pub fn resolve_account(prefs: &AppPreferences, id: Option<&str>) -> ResolvedClaudeAccount {
    let Some(id) = id.filter(|id| !id.is_empty() && *id != ROOT_ACCOUNT_ID) else {
        return root_account(prefs);
    };
    match prefs.claude_accounts.iter().find(|a| a.id == id) {
        Some(account) => ResolvedClaudeAccount {
            id: account.id.clone(),
            label: account.label.clone(),
            config_dir: Some(account.config_dir.clone()),
        },
        None => {
            log::warn!("Claude account {id} is not configured any more; using the root install");
            root_account(prefs)
        }
    }
}

/// The account every new Claude run uses.
pub fn active_account(prefs: &AppPreferences) -> ResolvedClaudeAccount {
    resolve_account(prefs, prefs.claude_active_account.as_deref())
}

/// Root first, then the extra accounts in settings order.
pub fn all_accounts(prefs: &AppPreferences) -> Vec<ResolvedClaudeAccount> {
    std::iter::once(root_account(prefs))
        .chain(
            prefs
                .claude_accounts
                .iter()
                .map(|account| ResolvedClaudeAccount {
                    id: account.id.clone(),
                    label: account.label.clone(),
                    config_dir: Some(account.config_dir.clone()),
                }),
        )
        .collect()
}

fn load_prefs(app: &tauri::AppHandle) -> AppPreferences {
    crate::load_preferences_sync(app).unwrap_or_default()
}

/// [`resolve_account`] with the saved preferences.
pub fn load_account(app: &tauri::AppHandle, id: Option<&str>) -> ResolvedClaudeAccount {
    resolve_account(&load_prefs(app), id)
}

/// [`active_account`] with the saved preferences.
pub fn load_active_account(app: &tauri::AppHandle) -> ResolvedClaudeAccount {
    active_account(&load_prefs(app))
}

/// [`all_accounts`] with the saved preferences.
pub fn load_all_accounts(app: &tauri::AppHandle) -> Vec<ResolvedClaudeAccount> {
    all_accounts(&load_prefs(app))
}

/// Which account a session's next Claude run uses.
///
/// A recorded account always wins: the Claude transcript only exists in that
/// account's folder. A session with Claude history but no record is from before
/// accounts existed and ran on the root install. A fresh session takes the active
/// account, and the caller records it.
pub fn session_account_id(
    recorded: Option<&str>,
    has_claude_history: bool,
    active_id: &str,
) -> String {
    if let Some(recorded) = recorded.filter(|id| !id.is_empty()) {
        return recorded.to_string();
    }
    if has_claude_history {
        return ROOT_ACCOUNT_ID.to_string();
    }
    active_id.to_string()
}

/// The macOS Keychain service Claude Code stores this folder's login under.
///
/// Claude Code 2.1.277, `SO()`: no suffix when `CLAUDE_CONFIG_DIR` is unset,
/// else `-` plus the first 8 hex chars of `sha256(CLAUDE_CONFIG_DIR)`.
/// Claude also NFC-normalizes the string first; ASCII paths are unchanged by that.
pub fn keychain_service(config_dir: Option<&str>) -> String {
    match config_dir {
        None => KEYCHAIN_SERVICE_BASE.to_string(),
        Some(dir) => {
            let digest = Sha256::digest(dir.as_bytes());
            let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
            format!("{KEYCHAIN_SERVICE_BASE}-{}", &hex[..8])
        }
    }
}

/// `.credentials.json` (Linux, Windows, and the macOS fallback).
pub fn credentials_file(config_dir: Option<&str>) -> Option<PathBuf> {
    match config_dir {
        Some(dir) => Some(Path::new(dir).join(".credentials.json")),
        None => dirs::home_dir().map(|home| home.join(".claude").join(".credentials.json")),
    }
}

/// The global config with `oauthAccount`: `~/.claude.json` for the root install,
/// `<dir>/.claude.json` for any other folder.
pub fn global_config_file(config_dir: Option<&str>) -> Option<PathBuf> {
    match config_dir {
        Some(dir) => Some(Path::new(dir).join(".claude.json")),
        None => dirs::home_dir().map(|home| home.join(".claude.json")),
    }
}

/// Usage cache file name per account, so each account keeps its own 5-minute cache.
pub fn usage_cache_file_name(config_dir: Option<&str>) -> String {
    match config_dir {
        None => "claude.json".to_string(),
        Some(dir) => {
            let service = keychain_service(Some(dir));
            let suffix = service.rsplit('-').next().unwrap_or("account");
            format!("claude-{suffix}.json")
        }
    }
}

/// Trim, expand `~`, drop trailing slashes. `None` for an empty or relative path.
pub fn normalize_config_dir(raw: &str, home: Option<&Path>) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let expanded = if trimmed == "~" {
        home?.to_path_buf()
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        home?.join(rest)
    } else {
        PathBuf::from(trimmed)
    };
    if !expanded.is_absolute() {
        return None;
    }
    let mut text = expanded.to_string_lossy().to_string();
    while text.len() > 1 && (text.ends_with('/') || text.ends_with('\\')) {
        text.pop();
    }
    Some(text)
}

/// Clean the account list before it is saved.
///
/// Drops accounts with no usable folder, accounts that point at the root install
/// (`~/.claude` as `CLAUDE_CONFIG_DIR` is a *different* login for Claude) and
/// duplicates. Creates missing folders. Resets the active account when it is gone.
pub fn normalize_accounts(prefs: &mut AppPreferences, home: Option<&Path>) {
    let root_dir = home.map(|home| home.join(".claude").to_string_lossy().to_string());
    let mut seen_ids: Vec<String> = Vec::new();
    let mut seen_dirs: Vec<String> = Vec::new();
    let mut kept = Vec::new();
    for mut account in std::mem::take(&mut prefs.claude_accounts) {
        let Some(dir) = normalize_config_dir(&account.config_dir, home) else {
            log::warn!("Dropping Claude account {}: no absolute folder", account.id);
            continue;
        };
        let id = account.id.trim().to_string();
        if id.is_empty()
            || id == ROOT_ACCOUNT_ID
            || seen_ids.contains(&id)
            || seen_dirs.contains(&dir)
            || root_dir.as_deref() == Some(dir.as_str())
        {
            log::warn!("Dropping Claude account {id}: duplicate or root folder {dir}");
            continue;
        }
        if let Err(e) = std::fs::create_dir_all(&dir) {
            log::warn!("Could not create Claude account folder {dir}: {e}");
        }
        account.id = id.clone();
        account.label = account.label.trim().to_string();
        if account.label.is_empty() {
            account.label = Path::new(&dir)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| dir.clone());
        }
        account.config_dir = dir.clone();
        seen_ids.push(id);
        seen_dirs.push(dir);
        kept.push(account);
    }
    prefs.claude_accounts = kept;
    if let Some(active) = prefs.claude_active_account.as_deref() {
        if active == ROOT_ACCOUNT_ID || !prefs.claude_accounts.iter().any(|a| a.id == active) {
            prefs.claude_active_account = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefs_with(accounts: Vec<ClaudeAccount>, active: Option<&str>) -> AppPreferences {
        AppPreferences {
            claude_root_label: Some("Personal".to_string()),
            claude_accounts: accounts,
            claude_active_account: active.map(str::to_string),
            ..AppPreferences::default()
        }
    }

    fn work() -> ClaudeAccount {
        ClaudeAccount {
            id: "acc-work".to_string(),
            label: "Work".to_string(),
            config_dir: "/Users/alice/.claude-work".to_string(),
        }
    }

    #[test]
    fn keychain_service_matches_claude_code() {
        assert_eq!(keychain_service(None), "Claude Code-credentials");
        // printf %s /Users/alice/.claude-work | shasum -a 256 | cut -c1-8
        let digest = Sha256::digest(b"/Users/alice/.claude-work");
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            keychain_service(Some("/Users/alice/.claude-work")),
            format!("Claude Code-credentials-{}", &hex[..8])
        );
        // Known value, computed with shasum: guards the format, not only the code path.
        assert_eq!(
            keychain_service(Some("/tmp/claude-test-a")),
            "Claude Code-credentials-60173520"
        );
    }

    #[test]
    fn files_resolve_per_folder() {
        assert_eq!(
            credentials_file(Some("/x/acc")).unwrap(),
            PathBuf::from("/x/acc/.credentials.json")
        );
        assert_eq!(
            global_config_file(Some("/x/acc")).unwrap(),
            PathBuf::from("/x/acc/.claude.json")
        );
        let home = dirs::home_dir().unwrap();
        assert_eq!(global_config_file(None).unwrap(), home.join(".claude.json"));
        assert_eq!(
            credentials_file(None).unwrap(),
            home.join(".claude/.credentials.json")
        );
        assert_eq!(usage_cache_file_name(None), "claude.json");
        assert_eq!(
            usage_cache_file_name(Some("/tmp/claude-test-a")),
            "claude-60173520.json"
        );
    }

    #[test]
    fn env_is_set_only_for_non_root_accounts() {
        let prefs = prefs_with(vec![work()], Some("acc-work"));
        let root = resolve_account(&prefs, None);
        assert!(root.is_root());
        assert_eq!(root.label, "Personal");
        assert_eq!(root.env(), None);

        let active = active_account(&prefs);
        assert_eq!(active.id, "acc-work");
        assert_eq!(
            active.env(),
            Some(("CLAUDE_CONFIG_DIR", "/Users/alice/.claude-work".to_string()))
        );

        let mut cmd = std::process::Command::new("true");
        active.apply_env(&mut cmd);
        let envs: Vec<_> = cmd.get_envs().collect();
        assert_eq!(envs.len(), 1);
        assert_eq!(envs[0].0, "CLAUDE_CONFIG_DIR");

        let mut root_cmd = std::process::Command::new("true");
        root.apply_env(&mut root_cmd);
        assert_eq!(root_cmd.get_envs().count(), 0);
    }

    #[test]
    fn unknown_or_removed_account_falls_back_to_root() {
        let prefs = prefs_with(vec![], None);
        assert!(resolve_account(&prefs, Some("gone")).is_root());
        assert!(resolve_account(&prefs, Some(ROOT_ACCOUNT_ID)).is_root());
        assert_eq!(
            resolve_account(&AppPreferences::default(), None).label,
            ROOT_ACCOUNT_DEFAULT_LABEL
        );
    }

    #[test]
    fn all_accounts_lists_root_first() {
        let prefs = prefs_with(vec![work()], None);
        let ids: Vec<_> = all_accounts(&prefs).into_iter().map(|a| a.id).collect();
        assert_eq!(ids, vec!["root", "acc-work"]);
    }

    #[test]
    fn session_account_recorded_wins_then_legacy_root_then_active() {
        assert_eq!(
            session_account_id(Some("acc-work"), true, "root"),
            "acc-work"
        );
        assert_eq!(session_account_id(Some("root"), false, "acc-work"), "root");
        // Old session: ran before accounts existed, its transcript is in ~/.claude.
        assert_eq!(session_account_id(None, true, "acc-work"), "root");
        // Fresh session: takes the active account.
        assert_eq!(session_account_id(None, false, "acc-work"), "acc-work");
    }

    #[test]
    fn normalize_config_dir_expands_and_trims() {
        let home = Path::new("/Users/alice");
        assert_eq!(
            normalize_config_dir(" ~/.claude-work/ ", Some(home)).as_deref(),
            Some("/Users/alice/.claude-work")
        );
        assert_eq!(normalize_config_dir("relative/dir", Some(home)), None);
        assert_eq!(normalize_config_dir("  ", Some(home)), None);
        assert_eq!(normalize_config_dir("/", Some(home)).as_deref(), Some("/"));
    }

    #[test]
    fn normalize_accounts_drops_bad_entries_and_creates_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let new_dir = home.join("acc-new");
        let mut prefs = prefs_with(
            vec![
                ClaudeAccount {
                    id: "a".into(),
                    label: " ".into(),
                    config_dir: format!("{}/", new_dir.display()),
                },
                ClaudeAccount {
                    id: "dup-dir".into(),
                    label: "Dup".into(),
                    config_dir: new_dir.display().to_string(),
                },
                ClaudeAccount {
                    id: "root-dir".into(),
                    label: "Root".into(),
                    config_dir: "~/.claude".into(),
                },
                ClaudeAccount {
                    id: "rel".into(),
                    label: "Rel".into(),
                    config_dir: "rel".into(),
                },
            ],
            Some("root-dir"),
        );
        normalize_accounts(&mut prefs, Some(home));
        assert_eq!(prefs.claude_accounts.len(), 1);
        let kept = &prefs.claude_accounts[0];
        assert_eq!(kept.config_dir, new_dir.display().to_string());
        assert_eq!(kept.label, "acc-new");
        assert!(new_dir.is_dir());
        assert_eq!(prefs.claude_active_account, None);
    }
}
