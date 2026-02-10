//! Configuration and path management for the embedded GitHub CLI

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Directory name for storing the GitHub CLI binary
pub const GH_CLI_DIR_NAME: &str = "gh-cli";

/// Name of the GitHub CLI binary
#[cfg(not(target_os = "windows"))]
pub const GH_CLI_BINARY_NAME: &str = "gh";

#[cfg(target_os = "windows")]
pub const GH_CLI_BINARY_NAME: &str = "gh.exe";

/// Get the directory where GitHub CLI is installed
///
/// Returns: `~/Library/Application Support/jean/gh-cli/` (macOS)
///          `~/.local/share/jean/gh-cli/` (Linux)
///          `%APPDATA%/jean/gh-cli/` (Windows)
pub fn get_gh_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    Ok(app_data_dir.join(GH_CLI_DIR_NAME))
}

/// Get the full path to the GitHub CLI binary
///
/// Returns: `~/Library/Application Support/jean/gh-cli/gh` (macOS/Linux)
///          `%APPDATA%/jean/gh-cli/gh.exe` (Windows)
pub fn get_gh_cli_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_gh_cli_dir(app)?.join(GH_CLI_BINARY_NAME))
}

/// Resolve the `gh` binary to use for commands.
///
/// Returns the embedded binary path if it exists, otherwise falls back to `"gh"` from PATH.
/// This ensures commands work whether `gh` was installed via the app or system-wide.
pub fn resolve_gh_binary(app: &AppHandle) -> PathBuf {
    if let Ok(embedded) = get_gh_cli_binary_path(app) {
        if embedded.exists() {
            return embedded;
        }
    }
    PathBuf::from("gh")
}

/// Ensure the CLI directory exists, creating it if necessary
pub fn ensure_gh_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cli_dir = get_gh_cli_dir(app)?;
    std::fs::create_dir_all(&cli_dir)
        .map_err(|e| format!("Failed to create GitHub CLI directory: {e}"))?;
    Ok(cli_dir)
}
