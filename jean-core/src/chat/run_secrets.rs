//! Per-run files that carry secrets to a CLI child process (#102).
//!
//! **Rule: secrets never go into process arguments.** Every local process of
//! the user (and on Linux every user) can read a command line with `ps`. A
//! secret goes to a child through its environment (`Command::env`), its stdin,
//! or a file that only the owner can read. This module is the file path.
//!
//! The MCP config for a run holds the Splitkick MCP token and the env values
//! of the user's own MCP servers, so it is written here and only its path goes
//! on the command line (`claude --mcp-config <path>`). Claude Code accepts a
//! file path for `--mcp-config` ("Load MCP servers from JSON files or
//! strings", `claude --help`; <https://code.claude.com/docs/en/cli-reference>).
//!
//! We do not use `${VAR}` expansion with the secrets in the child env: that
//! is documented for `.mcp.json` (<https://code.claude.com/docs/en/mcp>), not
//! for inline `--mcp-config` strings, and every env value of every user server
//! would need its own placeholder. A private file needs neither.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Directory (under the app data dir) for per-run secret files.
const RUN_SECRETS_DIR: &str = "run-secrets";

/// Files older than this are leftovers of a run that Splitkick did not see end
/// (crash, quit during a detached run). The CLI reads its config at start-up,
/// so a run that is still alive no longer needs its file. Younger files are
/// kept so that start-up cleanup cannot race a run that is just starting.
const STALE_AFTER: Duration = Duration::from_secs(60);

/// A secret file that is removed when the guard drops (the run ended).
#[derive(Debug)]
pub struct RunSecretFile {
    path: PathBuf,
}

impl RunSecretFile {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for RunSecretFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

pub fn run_secrets_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(RUN_SECRETS_DIR)
}

/// Write `contents` to `path` so that only the owner can read it (0600 on
/// Unix; on Windows the file inherits the private ACL of the user's app data
/// directory). The mode is set at creation, so the secret is never readable
/// by others, not even for a moment.
pub fn write_private_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    // `mode()` only applies to new files; force it for a reused path too.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(contents)?;
    file.flush()
}

/// Write the MCP config JSON of one run to a private file in
/// `<app data>/run-secrets/`. Pass `guard.path()` to the CLI and keep the
/// guard alive until the run ends; dropping it deletes the file.
///
/// Reuse this for any MCP server entry that carries a token (e.g. a browser
/// engine connection token): merge the entry into the config JSON, then call
/// this. Never put the token into an argument.
pub fn write_run_mcp_config(
    app_data_dir: &Path,
    session_id: &str,
    config_json: &str,
) -> Result<RunSecretFile, String> {
    let dir = run_secrets_dir(app_data_dir);
    create_private_dir(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join(format!("{session_id}-{}.mcp.json", uuid::Uuid::new_v4()));
    write_private_file(&path, config_json.as_bytes())
        .map_err(|e| format!("Failed to write MCP config file: {e}"))?;
    Ok(RunSecretFile { path })
}

/// Remove leftover secret files at start-up. Returns how many were removed.
pub fn cleanup_stale_run_secrets(app_data_dir: &Path) -> usize {
    cleanup_older_than(&run_secrets_dir(app_data_dir), STALE_AFTER)
}

fn cleanup_older_than(dir: &Path, max_age: Duration) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let now = SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|modified| now.duration_since(modified).unwrap_or_default() >= max_age)
            .unwrap_or(true);
        if path.is_file() && old && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_config_file_holds_the_config_and_is_removed_on_drop() {
        let temp = tempfile::tempdir().unwrap();
        let guard = write_run_mcp_config(temp.path(), "s1", r#"{"mcpServers":{}}"#).unwrap();
        let path = guard.path().to_path_buf();
        assert!(path.starts_with(run_secrets_dir(temp.path())));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            r#"{"mcpServers":{}}"#
        );
        drop(guard);
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn mcp_config_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let guard = write_run_mcp_config(temp.path(), "s1", "{}").unwrap();
        let mode = std::fs::metadata(guard.path())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        let dir_mode = std::fs::metadata(run_secrets_dir(temp.path()))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(dir_mode & 0o777, 0o700);
    }

    #[cfg(unix)]
    #[test]
    fn private_file_tightens_an_existing_file() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("f.json");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_private_file(&path, b"new").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn cleanup_removes_old_files_and_keeps_new_ones() {
        let temp = tempfile::tempdir().unwrap();
        let guard = write_run_mcp_config(temp.path(), "s1", "{}").unwrap();
        let dir = run_secrets_dir(temp.path());

        // A run that is just starting keeps its file.
        assert_eq!(cleanup_stale_run_secrets(temp.path()), 0);
        assert!(guard.path().exists());

        // A leftover (any age >= threshold) is removed.
        assert_eq!(cleanup_older_than(&dir, Duration::ZERO), 1);
        assert!(!guard.path().exists());
    }

    #[test]
    fn cleanup_without_a_dir_is_a_no_op() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(cleanup_stale_run_secrets(temp.path()), 0);
    }
}
