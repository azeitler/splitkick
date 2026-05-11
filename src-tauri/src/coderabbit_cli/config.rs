//! Configuration and path management for the CodeRabbit CLI.

use crate::platform::silent_command;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const CODERABBIT_CLI_DIR_NAME: &str = "coderabbit-cli";

#[cfg(windows)]
pub const CODERABBIT_BINARY_NAME: &str = "coderabbit.exe";
#[cfg(not(windows))]
pub const CODERABBIT_BINARY_NAME: &str = "coderabbit";

pub fn get_coderabbit_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    Ok(app_data_dir.join(CODERABBIT_CLI_DIR_NAME))
}

pub fn get_coderabbit_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_coderabbit_cli_dir(app)?.join(CODERABBIT_BINARY_NAME))
}

pub fn ensure_coderabbit_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cli_dir = get_coderabbit_cli_dir(app)?;
    std::fs::create_dir_all(&cli_dir)
        .map_err(|e| format!("Failed to create CodeRabbit CLI directory: {e}"))?;
    Ok(cli_dir)
}

pub fn resolve_coderabbit_binary(app: &AppHandle) -> PathBuf {
    let use_path = crate::get_preferences_path(app)
        .ok()
        .and_then(|prefs_path| std::fs::read_to_string(prefs_path).ok())
        .and_then(|contents| serde_json::from_str::<crate::AppPreferences>(&contents).ok())
        .map(|prefs| prefs.coderabbit_cli_source == "path")
        .unwrap_or(false);

    if use_path {
        let which_cmd = if cfg!(target_os = "windows") {
            "where"
        } else {
            "which"
        };
        if let Ok(output) = silent_command(which_cmd).arg("coderabbit").output() {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path_str.is_empty() {
                    let path = PathBuf::from(&path_str);
                    if path.exists() {
                        return path;
                    }
                }
            }
        }
        log::warn!("coderabbit_cli_source is 'path' but coderabbit was not found in PATH; falling back to Jean-managed binary");
    }

    get_coderabbit_binary_path(app)
        .unwrap_or_else(|_| PathBuf::from(CODERABBIT_CLI_DIR_NAME).join(CODERABBIT_BINARY_NAME))
}
