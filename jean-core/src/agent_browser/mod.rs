//! Jean agent browser: persistent Chromium profile + agent-browser MCP install.
//!
//! Engine: [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)
//! (Vercel Labs). Jean owns the profile directory under app data and writes
//! backend MCP configs so Claude/Codex/etc. can drive a browser the user logged
//! into manually. The browser itself is Chromium / Chrome for Testing.

pub mod config;
pub mod playwright;

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::platform::{detect_cli_in_path, host_cli_command};

/// MCP server key written into CLI configs.
pub const MCP_SERVER_NAME: &str = "agent-browser";

/// npm package name for agent-browser.
pub const NPM_PACKAGE: &str = "agent-browser";

/// Jean-managed npm install directory under app data.
pub const CLI_DIR_NAME: &str = "agent-browser-cli";

/// Env var agent-browser uses for a persistent profile directory.
const PROFILE_ENV: &str = "AGENT_BROWSER_PROFILE";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBrowserStatus {
    /// Whether `agent-browser` was found (Jean-managed or PATH / WSL PATH).
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    /// Absolute path to Jean-managed Chromium user-data-dir.
    pub profile_path: String,
    /// Whether the profile directory exists on disk.
    pub profile_exists: bool,
    /// Jean-managed npm install directory (may not exist yet).
    pub managed_dir: String,
    /// Whether the binary is Jean-managed under app data.
    pub managed_install: bool,
    /// Suggested MCP install command / snippet for Claude JSON.
    pub claude_snippet: String,
    pub codex_snippet: String,
    /// Operator hint when binary is missing.
    pub install_hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBrowserInstallResult {
    pub backend: String,
    pub status: String,
    pub path: Option<String>,
    pub backup_path: Option<String>,
    pub server_name: String,
    pub message: String,
}

/// The agent-browser server entry: `agent-browser mcp` with the profile env.
fn agent_browser_spec(command: String, profile_path: String) -> config::ServerSpec {
    config::ServerSpec {
        name: MCP_SERVER_NAME.to_string(),
        command,
        args: vec!["mcp".to_string()],
        env: vec![(PROFILE_ENV.to_string(), profile_path)],
    }
}

/// Resolve Jean-managed persistent profile directory.
pub fn profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(app_data.join("agent-browser").join("profile"))
}

/// Jean-managed npm prefix for agent-browser.
pub fn managed_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(app_data.join(CLI_DIR_NAME))
}

fn managed_bin_path(cli_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        cli_dir
            .join("node_modules")
            .join(".bin")
            .join("agent-browser.cmd")
    }
    #[cfg(not(windows))]
    {
        cli_dir
            .join("node_modules")
            .join(".bin")
            .join("agent-browser")
    }
}

/// Path to Jean-managed `agent-browser` if the npm install is present.
pub fn find_managed_binary(app: &AppHandle) -> Option<PathBuf> {
    let path = managed_bin_path(&managed_cli_dir(app).ok()?);
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

/// Resolve command path: Jean-managed install first, then PATH.
pub fn resolve_agent_browser_binary(app: &AppHandle) -> ResolvedBinary {
    if let Some(path) = find_managed_binary(app) {
        let version = read_binary_version(&path);
        return ResolvedBinary {
            installed: true,
            path: Some(path.to_string_lossy().to_string()),
            version,
            managed: true,
        };
    }

    let detection = detect_cli_in_path("agent-browser", None, None);
    ResolvedBinary {
        installed: detection.found,
        path: detection.path,
        version: detection.version,
        managed: false,
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedBinary {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub managed: bool,
}

fn read_binary_version(path: &Path) -> Option<String> {
    let output = host_cli_command(&path.to_string_lossy(), None)
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        None
    } else {
        Some(line.to_string())
    }
}

/// Create the profile directory if missing.
pub fn ensure_profile(app: &AppHandle) -> Result<PathBuf, String> {
    let path = profile_path(app)?;
    std::fs::create_dir_all(&path).map_err(|e| {
        format!(
            "Failed to create agent browser profile {}: {e}",
            path.display()
        )
    })?;
    Ok(path)
}

fn build_entry(app: &AppHandle) -> Result<config::ServerSpec, String> {
    let profile = ensure_profile(app)?;
    let resolved = resolve_agent_browser_binary(app);
    let command = resolved
        .path
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "agent-browser".to_string());
    Ok(agent_browser_spec(
        command,
        profile.to_string_lossy().to_string(),
    ))
}

/// Status for Settings UI / operators.
pub async fn get_agent_browser_status(app: AppHandle) -> Result<AgentBrowserStatus, String> {
    let profile = profile_path(&app)?;
    let profile_exists = profile.is_dir();
    let managed_dir = managed_cli_dir(&app)?;
    let resolved = resolve_agent_browser_binary(&app);
    let entry = agent_browser_spec(
        resolved
            .path
            .clone()
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "agent-browser".to_string()),
        profile.to_string_lossy().to_string(),
    );

    Ok(AgentBrowserStatus {
        installed: resolved.installed,
        binary_path: resolved.path,
        version: resolved.version,
        profile_path: profile.to_string_lossy().to_string(),
        profile_exists,
        managed_dir: managed_dir.to_string_lossy().to_string(),
        managed_install: resolved.managed,
        claude_snippet: entry.claude_snippet(),
        codex_snippet: entry.codex_snippet(),
        install_hint: "Use Install agent-browser in Settings, or: npm install -g agent-browser && agent-browser install".to_string(),
    })
}

/// Ensure profile dir exists (idempotent).
pub async fn ensure_agent_browser_profile(app: AppHandle) -> Result<AgentBrowserStatus, String> {
    ensure_profile(&app)?;
    get_agent_browser_status(app).await
}

/// Install agent-browser via npm into Jean app data, then download Chromium
/// (`agent-browser install`). Idempotent reinstall/update.
///
/// Performs synchronous npm/network work; WebSocket dispatch should run this
/// on the blocking pool (it runs every command there).
pub async fn install_agent_browser(app: AppHandle) -> Result<AgentBrowserStatus, String> {
    install_agent_browser_sync(&app)
}

fn install_agent_browser_sync(app: &AppHandle) -> Result<AgentBrowserStatus, String> {
    let cli_dir = managed_cli_dir(app)?;
    std::fs::create_dir_all(&cli_dir).map_err(|e| {
        format!(
            "Failed to create agent-browser install dir {}: {e}",
            cli_dir.display()
        )
    })?;

    // Ensure profile exists so MCP install can succeed right after.
    ensure_profile(app)?;
    let npm_path = crate::prerequisites::require_npm("agent-browser")?;

    let npm_output = host_cli_command(&npm_path, None)
        .args(["install", "--prefix"])
        .arg(&cli_dir)
        .arg(NPM_PACKAGE)
        .output()
        .map_err(|e| {
            format!("Failed to run npm install for agent-browser (is npm on PATH?): {e}")
        })?;

    if !npm_output.status.success() {
        let stderr = String::from_utf8_lossy(&npm_output.stderr)
            .trim()
            .to_string();
        let stdout = String::from_utf8_lossy(&npm_output.stdout)
            .trim()
            .to_string();
        return Err(format!(
            "npm install agent-browser failed: {}",
            if stderr.is_empty() { stdout } else { stderr }
        ));
    }

    let binary = managed_bin_path(&cli_dir);
    if !binary.is_file() {
        return Err(format!(
            "npm install completed but agent-browser was not found at {}",
            binary.display()
        ));
    }

    // Download Chrome for Testing into agent-browser's cache.
    // Linux servers often need OS shared libs; --with-deps helps when available.
    let mut install_cmd = host_cli_command(&binary.to_string_lossy(), None);
    install_cmd.arg("install");
    if cfg!(target_os = "linux") {
        install_cmd.arg("--with-deps");
    }
    let chromium_output = install_cmd
        .output()
        .map_err(|e| format!("Failed to run `agent-browser install` for Chromium download: {e}"))?;

    if !chromium_output.status.success() {
        // Retry without --with-deps (flag may not exist on older versions).
        let retry = host_cli_command(&binary.to_string_lossy(), None)
            .arg("install")
            .output()
            .map_err(|e| format!("Failed to run `agent-browser install`: {e}"))?;
        if !retry.status.success() {
            let stderr = String::from_utf8_lossy(&chromium_output.stderr)
                .trim()
                .to_string();
            let stdout = String::from_utf8_lossy(&chromium_output.stdout)
                .trim()
                .to_string();
            let retry_err = String::from_utf8_lossy(&retry.stderr).trim().to_string();
            return Err(format!(
                "agent-browser install (Chromium) failed: {}",
                [stderr, stdout, retry_err]
                    .into_iter()
                    .find(|s| !s.is_empty())
                    .unwrap_or_else(|| "unknown error".to_string())
            ));
        }
    }

    // Build status without re-entering async.
    let profile = profile_path(app)?;
    let resolved = resolve_agent_browser_binary(app);
    if !resolved.installed {
        return Err("agent-browser install finished but binary still not detected".to_string());
    }
    let entry = agent_browser_spec(
        resolved
            .path
            .clone()
            .unwrap_or_else(|| binary.to_string_lossy().to_string()),
        profile.to_string_lossy().to_string(),
    );

    Ok(AgentBrowserStatus {
        installed: true,
        binary_path: resolved.path,
        version: resolved.version,
        profile_path: profile.to_string_lossy().to_string(),
        profile_exists: profile.is_dir(),
        managed_dir: cli_dir.to_string_lossy().to_string(),
        managed_install: true,
        claude_snippet: entry.claude_snippet(),
        codex_snippet: entry.codex_snippet(),
        install_hint: "Use Install agent-browser in Settings, or: npm install -g agent-browser && agent-browser install".to_string(),
    })
}

/// Install `agent-browser` MCP server into selected CLI backends.
///
/// Creates the Jean profile directory and writes backend config with
/// `AGENT_BROWSER_PROFILE` pointing at it. Prefers the Jean-managed binary when
/// present; otherwise requires `agent-browser` on PATH.
pub async fn install_agent_browser_mcp(
    app: AppHandle,
    backends: Option<Vec<String>>,
) -> Result<Vec<AgentBrowserInstallResult>, String> {
    let entry = build_entry(&app)?;
    let backends =
        backends.unwrap_or_else(|| config::BACKENDS.iter().map(|b| b.to_string()).collect());

    let home = dirs::home_dir().ok_or_else(|| "Home directory unavailable".to_string())?;
    let results: Vec<AgentBrowserInstallResult> = backends
        .into_iter()
        .map(|backend| {
            match config::backend_config(&home, &backend)
                .and_then(|target| config::edit_servers(&target, &[], Some(&entry)))
            {
                Ok((path, backup_path)) => AgentBrowserInstallResult {
                    backend,
                    status: "installed".to_string(),
                    path: Some(path.to_string_lossy().to_string()),
                    backup_path: backup_path.map(|p| p.to_string_lossy().to_string()),
                    server_name: MCP_SERVER_NAME.to_string(),
                    message: format!("Installed {MCP_SERVER_NAME}"),
                },
                Err(error) => AgentBrowserInstallResult {
                    backend,
                    status: "error".to_string(),
                    path: None,
                    backup_path: None,
                    server_name: MCP_SERVER_NAME.to_string(),
                    message: error,
                },
            }
        })
        .collect();

    // Best-effort: enable agent-browser for installed backends in Jean prefs.
    let installed: Vec<String> = results
        .iter()
        .filter(|r| r.status == "installed")
        .map(|r| r.backend.clone())
        .collect();
    if let Err(e) = enable_in_preferences(&app, MCP_SERVER_NAME, &installed, None) {
        log::warn!("Failed to auto-enable agent-browser MCP in preferences: {e}");
    }

    Ok(results)
}

/// Mark `server_name` as known and enabled for `backends` in the
/// preferences file, and set `browser_engine` when given.
pub(crate) fn enable_in_preferences(
    app: &AppHandle,
    server_name: &str,
    backends: &[String],
    browser_engine: Option<&str>,
) -> Result<(), String> {
    let path = crate::get_preferences_path(app)?;
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "{}".to_string(),
        Err(e) => return Err(format!("Failed to read preferences: {e}")),
    };
    let mut prefs: Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse preferences: {e}"))?;

    let Some(obj) = prefs.as_object_mut() else {
        return Ok(());
    };

    if let Some(engine) = browser_engine {
        obj.insert("browser_engine".into(), json!(engine));
    }
    if !obj.contains_key("default_enabled_mcp_servers") {
        obj.insert("default_enabled_mcp_servers".into(), json!([]));
    }
    if !obj.contains_key("known_mcp_servers") {
        obj.insert("known_mcp_servers".into(), json!([]));
    }

    let keys: Vec<String> = backends
        .iter()
        .map(|backend| format!("{backend}:{server_name}"))
        .collect();

    for field in ["default_enabled_mcp_servers", "known_mcp_servers"] {
        let Some(arr) = obj.get_mut(field).and_then(|v| v.as_array_mut()) else {
            continue;
        };
        for key in &keys {
            let key_val = Value::String(key.clone());
            if !arr.iter().any(|v| v == &key_val) {
                arr.push(key_val);
            }
        }
    }

    let updated = serde_json::to_string_pretty(&prefs)
        .map_err(|e| format!("Failed to serialize preferences: {e}"))?;
    std::fs::write(&path, updated).map_err(|e| format!("Failed to write preferences: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn agent_browser_snippets_carry_the_profile_env() {
        let entry = agent_browser_spec("agent-browser".into(), "/data/profile".into());
        let claude = entry.claude_snippet();
        assert!(claude.contains("AGENT_BROWSER_PROFILE"));
        assert!(claude.contains("/data/profile"));
        assert!(claude.contains("\"mcp\""));
        let codex = entry.codex_snippet();
        assert!(codex.contains("[mcp_servers.agent-browser]"));
        assert!(codex.contains("AGENT_BROWSER_PROFILE"));
        assert!(codex.contains("enabled = true"));
    }

    #[test]
    fn managed_bin_path_points_at_node_modules_bin() {
        let dir = TempDir::new().unwrap();
        let bin = managed_bin_path(dir.path());
        let s = bin.to_string_lossy();
        assert!(s.contains("node_modules"));
        assert!(s.contains(".bin"));
        assert!(s.contains("agent-browser"));
    }
}
