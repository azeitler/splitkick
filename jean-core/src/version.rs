//! Product version for the running host binary.
//!
//! `env!("CARGO_PKG_VERSION")` inside jean-core always reflects the **library**
//! crate version, not jean-server / desktop Jean. Server self-update compared
//! that library version against `server-latest.json` and got stuck offering
//! "0.1.68" forever while the binary still reported "0.1.67".
//!
//! Host binaries must call [`set_app_version`] once at startup with their own
//! `env!("CARGO_PKG_VERSION")`.

use std::sync::OnceLock;

static APP_VERSION: OnceLock<&'static str> = OnceLock::new();

/// Record the host binary's product version. Safe to call more than once; the
/// first value wins.
pub fn set_app_version(version: &'static str) {
    let _ = APP_VERSION.set(version);
}

/// Product version of the running binary (host override or jean-core fallback).
pub fn app_version() -> &'static str {
    APP_VERSION
        .get()
        .copied()
        .unwrap_or(env!("CARGO_PKG_VERSION"))
}

static RELEASE_VERSION: OnceLock<String> = OnceLock::new();

/// Record the version the build was *released* as, when it differs from the
/// Cargo version. Safe to call more than once; the first value wins.
///
/// A JeanZ release keeps `Cargo.toml` at the upstream version (`0.1.73`) and
/// gets its fork suffix (`0.1.73-z.11`) only from CI, as a `tauri build -c`
/// layer — so the bundle carries it, `CARGO_PKG_VERSION` does not. The desktop
/// shell passes the bundle version here.
///
/// Only the update check reads it: it must compare the installed build against
/// the release feed the way the native updater does. `app_version()` stays the
/// plain version, because the remote-version check compares it with the
/// client's own plain `package.json` version.
pub fn set_release_version(version: impl Into<String>) {
    let _ = RELEASE_VERSION.set(version.into());
}

/// The released version of this build, falling back to [`app_version`] for
/// hosts that never set one (headless `jean-server`, local builds).
pub fn release_version() -> &'static str {
    RELEASE_VERSION
        .get()
        .map(String::as_str)
        .unwrap_or_else(app_version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_cargo_pkg_version_when_unset() {
        // Other tests in this process may have set the override; only assert
        // the fallback path when still empty.
        if APP_VERSION.get().is_none() {
            assert_eq!(app_version(), env!("CARGO_PKG_VERSION"));
        }
    }

    #[test]
    fn release_version_falls_back_to_the_app_version() {
        // Headless jean-server and local builds never set one.
        if RELEASE_VERSION.get().is_none() {
            assert_eq!(release_version(), app_version());
        }
    }

    #[test]
    fn release_version_keeps_the_fork_suffix_and_the_first_value() {
        set_release_version("0.1.73-z.11");
        set_release_version("0.1.73-z.99");
        assert_eq!(release_version(), "0.1.73-z.11");
        // The plain version the remote-version check compares is untouched.
        assert!(!app_version().contains("-z."));
    }
}
