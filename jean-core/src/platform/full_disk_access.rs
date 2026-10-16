//! macOS Full Disk Access (FDA): status probe and System Settings deep link.
//!
//! Agents spawn many child binaries, and macOS asks separately for each one
//! ("would like to access data from other apps"). FDA is inherited by those
//! children, so one grant stops the prompts (issue #31, diagnosis in #20).
//!
//! There is no API to request or read FDA. The probe opens the user's TCC
//! database, which only an app with FDA may read. A running process keeps
//! the TCC state it started with, so the probe stays `Denied` after the user
//! grants access until the app relaunches. Do not poll it.

use serde::Serialize;
use std::path::Path;

const FULL_DISK_ACCESS_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FullDiskAccessStatus {
    Granted,
    Denied,
    NotApplicable,
}

/// Report whether this process has Full Disk Access. Off macOS: `NotApplicable`.
pub fn full_disk_access_status() -> FullDiskAccessStatus {
    if !cfg!(target_os = "macos") {
        return FullDiskAccessStatus::NotApplicable;
    }
    match dirs::home_dir() {
        Some(home) => probe_tcc_db(
            &home
                .join("Library")
                .join("Application Support")
                .join("com.apple.TCC")
                .join("TCC.db"),
        ),
        None => FullDiskAccessStatus::Denied,
    }
}

/// Only open the file: no SQL, no sqlite dependency. Any failure (usually
/// `authorization denied`) counts as `Denied`.
fn probe_tcc_db(path: &Path) -> FullDiskAccessStatus {
    match std::fs::File::open(path) {
        Ok(_) => FullDiskAccessStatus::Granted,
        Err(_) => FullDiskAccessStatus::Denied,
    }
}

/// Open System Settings → Privacy & Security → Full Disk Access.
pub fn open_full_disk_access_settings() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Full Disk Access is only available on macOS".to_string());
    }
    super::open_url_in_browser(FULL_DISK_ACCESS_SETTINGS_URL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_file_is_granted() {
        let file = std::env::temp_dir().join(format!("fda-probe-{}", std::process::id()));
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(probe_tcc_db(&file), FullDiskAccessStatus::Granted);
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn unreadable_file_is_denied() {
        let missing = std::env::temp_dir().join("fda-probe-does-not-exist/TCC.db");
        assert_eq!(probe_tcc_db(&missing), FullDiskAccessStatus::Denied);
    }

    #[test]
    fn status_serializes_snake_case() {
        assert_eq!(
            serde_json::to_value(FullDiskAccessStatus::NotApplicable).unwrap(),
            serde_json::json!("not_applicable")
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn not_applicable_off_macos() {
        assert_eq!(
            full_disk_access_status(),
            FullDiskAccessStatus::NotApplicable
        );
        assert!(open_full_disk_access_settings().is_err());
    }
}
