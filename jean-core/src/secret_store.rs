//! Secrets Splitkick keeps for the user: remote connection tokens (#94) and
//! the Playwright extension token (#104).
//!
//! On macOS a secret lives in the login Keychain. Each item's account is
//! `<data dir>/<id>`, so the installed app, the dev build and any isolated
//! profile never share an item. Elsewhere, and when [`TOKEN_STORE_ENV`] is
//! `file` (sealed test runs), it lives in a `0600` JSON file in the data dir.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// `file` keeps secrets in the `0600` file even on macOS. The sealed e2e
/// instances set it, so a test run never writes to the login Keychain.
pub const TOKEN_STORE_ENV: &str = "SPLITKICK_REMOTE_TOKEN_STORE";

/// `1` lets a dev build use the login Keychain (to test exactly that).
pub const DEV_KEYCHAIN_ENV: &str = "SPLITKICK_DEV_KEYCHAIN";

/// Whether this build may touch the macOS login Keychain at all: its own
/// secrets, and reading the Claude and Codex logins.
///
/// A dev build is signed ad hoc, and each rebuild gets a new signature. macOS
/// ties "Always Allow" to the signature, so every rebuild asked for Keychain
/// access again and stopped unattended dev runs. Dev builds therefore keep
/// their secrets in the `0600` file and skip the Keychain reads, unless
/// [`DEV_KEYCHAIN_ENV`] is `1`. Release builds always use the Keychain.
pub fn keychain_allowed() -> bool {
    keychain_allowed_for(
        cfg!(debug_assertions),
        std::env::var(DEV_KEYCHAIN_ENV).ok().as_deref(),
    )
}

fn keychain_allowed_for(dev_build: bool, dev_keychain: Option<&str>) -> bool {
    !dev_build || dev_keychain == Some("1")
}

#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

/// Where the secrets of one feature are kept.
pub(crate) enum SecretStore {
    #[cfg(target_os = "macos")]
    Keychain {
        service: &'static str,
        account_prefix: String,
    },
    File(PathBuf),
}

impl SecretStore {
    /// The store for `dir`: Keychain items of `service` on macOS, otherwise
    /// `dir/<file_name>`.
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    pub(crate) fn for_dir(dir: &Path, service: &'static str, file_name: &str) -> Self {
        #[cfg(target_os = "macos")]
        {
            let forced_file = std::env::var(TOKEN_STORE_ENV).is_ok_and(|v| v == "file");
            if !forced_file && keychain_allowed() {
                return Self::Keychain {
                    service,
                    account_prefix: dir.display().to_string(),
                };
            }
        }
        Self::File(dir.join(file_name))
    }

    fn read_file(path: &Path) -> Result<BTreeMap<String, String>, String> {
        match std::fs::read_to_string(path) {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse {}: {e}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(format!("Failed to read {}: {e}", path.display())),
        }
    }

    fn write_file(path: &Path, tokens: &BTreeMap<String, String>) -> Result<(), String> {
        let body = serde_json::to_vec_pretty(tokens)
            .map_err(|e| format!("Failed to serialize tokens: {e}"))?;
        write_private(path, &body)
    }

    pub(crate) fn get(&self, id: &str) -> Result<Option<String>, String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain {
                service,
                account_prefix,
            } => {
                let account = format!("{account_prefix}/{id}");
                match security_framework::passwords::get_generic_password(service, &account) {
                    Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
                    Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
                    Err(e) => Err(format!("Keychain read failed: {e}")),
                }
            }
            Self::File(path) => Ok(Self::read_file(path)?.remove(id)),
        }
    }

    pub(crate) fn set(&self, id: &str, token: &str) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain {
                service,
                account_prefix,
            } => {
                let account = format!("{account_prefix}/{id}");
                security_framework::passwords::set_generic_password(
                    service,
                    &account,
                    token.as_bytes(),
                )
                .map_err(|e| format!("Keychain write failed: {e}"))
            }
            Self::File(path) => {
                let mut tokens = Self::read_file(path)?;
                tokens.insert(id.to_string(), token.to_string());
                Self::write_file(path, &tokens)
            }
        }
    }

    pub(crate) fn delete(&self, id: &str) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain {
                service,
                account_prefix,
            } => {
                let account = format!("{account_prefix}/{id}");
                match security_framework::passwords::delete_generic_password(service, &account) {
                    Ok(()) => Ok(()),
                    Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
                    Err(e) => Err(format!("Keychain delete failed: {e}")),
                }
            }
            Self::File(path) => {
                let mut tokens = Self::read_file(path)?;
                if tokens.remove(id).is_some() {
                    Self::write_file(path, &tokens)?;
                }
                Ok(())
            }
        }
    }
}

/// Write via a temp file and rename, readable by the owner only.
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&tmp)
        .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::keychain_allowed_for;

    #[test]
    fn release_builds_use_the_keychain() {
        assert!(keychain_allowed_for(false, None));
        assert!(keychain_allowed_for(false, Some("0")));
    }

    /// Each rebuild of a dev build gets a new ad-hoc signature, and macOS asks
    /// for Keychain access again, which stops unattended dev runs.
    #[test]
    fn dev_builds_skip_the_keychain_unless_asked() {
        assert!(!keychain_allowed_for(true, None));
        assert!(!keychain_allowed_for(true, Some("0")));
        assert!(!keychain_allowed_for(true, Some("true")));
        assert!(keychain_allowed_for(true, Some("1")));
    }
}
