//! Linux has no tray: its library may be missing, and the Rust binding aborts
//! then. With no way back, the app does not stay running without a window.

use tauri::AppHandle;

pub(crate) fn quit_requested() -> bool {
    false
}

pub(crate) fn has_way_back() -> bool {
    false
}

#[tauri::command]
pub(crate) async fn refresh_tray(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub(crate) async fn set_tray_update_ready(
    _app: AppHandle,
    _version: Option<String>,
) -> Result<(), String> {
    Ok(())
}
