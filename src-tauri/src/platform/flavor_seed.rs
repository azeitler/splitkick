//! First-start seeding for a build flavor such as JeanZ.
//!
//! A flavor ships its own bundle identifier so macOS can hold a separate
//! privacy grant for it (see `docs/developer/fork-macos-builds.md`). Jean's own
//! data does not follow the identifier — `jean_core::resolve_data_dir()` pins
//! it — but two stores outside Jean's control still do:
//!
//! - the WebKit website data store, which holds `localStorage`: the client
//!   zoom, the client preferences and the remote-connection list;
//! - the state files the Tauri plugins keep beside the data directory, namely
//!   the window geometry and the persisted file scope.
//!
//! On its first start a flavor copies both from stable Jean, so it opens
//! looking exactly like the app it was built from. Every copy is best effort:
//! a failure leaves the flavor with empty state, which is what it would have
//! had anyway, and never stops the app from starting.

use std::fs;
use std::path::{Path, PathBuf};

/// Copy stable Jean's WebView store and plugin state into this flavor's
/// locations, once. Does nothing for stable Jean itself.
pub fn seed_flavor_state(identifier: &str) {
    if identifier == jean_core::DATA_DIR_NAME {
        return;
    }

    if let Some(home) = dirs::home_dir() {
        // `~/Library/WebKit/<identifier>`. The per-origin directory names
        // inside it are hashed from the origin and a salt that travels with
        // the tree, so a whole-tree copy lands `localStorage` at the path the
        // flavor's WebView will look in.
        let webkit = home.join("Library").join("WebKit");
        seed_once(
            &webkit.join(jean_core::DATA_DIR_NAME),
            &webkit.join(identifier),
        );
    }

    if let Some(data) = dirs::data_dir() {
        let stable = data.join(jean_core::DATA_DIR_NAME);
        let flavor = data.join(identifier);
        // These sit next to Jean's data rather than inside it, and the plugins
        // that own them resolve the directory from the bundle identifier.
        for name in [".window-state.json", ".persisted-scope"] {
            seed_once(&stable.join(name), &flavor.join(name));
        }
    }
}

/// Copy `from` to `to` unless `to` already exists.
///
/// The copy lands on a temporary sibling and is renamed into place, so an
/// interrupted run leaves nothing behind and the next start tries again. A
/// half-written target would otherwise look like a finished seeding forever.
fn seed_once(from: &Path, to: &Path) {
    if to.exists() || !from.exists() {
        return;
    }
    let Some(parent) = to.parent() else {
        return;
    };
    if let Err(error) = fs::create_dir_all(parent) {
        log::warn!("Could not prepare {}: {error}", parent.display());
        return;
    }

    let staged = staging_path(to);
    let _ = remove_any(&staged);

    let result = copy_tree(from, &staged).and_then(|()| fs::rename(&staged, to));
    match result {
        Ok(()) => log::info!("Seeded {} from {}", to.display(), from.display()),
        Err(error) => {
            log::warn!(
                "Could not seed {} from {}: {error}",
                to.display(),
                from.display()
            );
            let _ = remove_any(&staged);
        }
    }
}

fn staging_path(to: &Path) -> PathBuf {
    let name = to
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    to.with_file_name(format!(".{name}.seeding-{}", std::process::id()))
}

fn remove_any(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else if path.exists() {
        fs::remove_file(path)
    } else {
        Ok(())
    }
}

/// Recursive copy. Symlinks are followed for files and skipped for anything
/// else, so a loop cannot make this run forever.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(from)?;
    if metadata.is_file() {
        fs::copy(from, to)?;
        return Ok(());
    }
    if !metadata.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        copy_tree(&entry.path(), &to.join(entry.file_name()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{copy_tree, seed_once};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn a_whole_tree_is_copied() {
        let root = tempdir().unwrap();
        let from = root.path().join("stable");
        fs::create_dir_all(from.join("WebsiteData/Default/origin/LocalStorage")).unwrap();
        fs::write(from.join("WebsiteData/Default/salt"), b"salt").unwrap();
        fs::write(
            from.join("WebsiteData/Default/origin/LocalStorage/localstorage.sqlite3"),
            b"rows",
        )
        .unwrap();

        let to = root.path().join("flavor");
        seed_once(&from, &to);

        assert_eq!(
            fs::read(to.join("WebsiteData/Default/origin/LocalStorage/localstorage.sqlite3"))
                .unwrap(),
            b"rows"
        );
        // The salt names the per-origin directories, so it has to travel too.
        assert_eq!(
            fs::read(to.join("WebsiteData/Default/salt")).unwrap(),
            b"salt"
        );
    }

    #[test]
    fn a_single_file_is_copied_into_a_directory_that_does_not_exist_yet() {
        let root = tempdir().unwrap();
        let from = root.path().join("stable/.window-state.json");
        fs::create_dir_all(from.parent().unwrap()).unwrap();
        fs::write(&from, b"{}").unwrap();

        let to = root.path().join("flavor/.window-state.json");
        seed_once(&from, &to);

        assert_eq!(fs::read(&to).unwrap(), b"{}");
    }

    // Seeding is a first-start step. Later starts must leave the flavor's own
    // state alone, or every launch would throw away what the user just did.
    #[test]
    fn an_existing_target_is_never_overwritten() {
        let root = tempdir().unwrap();
        let from = root.path().join("stable.json");
        let to = root.path().join("flavor.json");
        fs::write(&from, b"stable").unwrap();
        fs::write(&to, b"flavor").unwrap();

        seed_once(&from, &to);

        assert_eq!(fs::read(&to).unwrap(), b"flavor");
    }

    #[test]
    fn a_missing_source_leaves_no_target_behind() {
        let root = tempdir().unwrap();
        let to = root.path().join("flavor.json");

        seed_once(&root.path().join("absent.json"), &to);

        assert!(!to.exists());
    }

    // A failed copy must not leave a half-written target, because that would
    // read as "already seeded" and every later start would skip the retry.
    #[test]
    fn a_failed_copy_leaves_neither_a_target_nor_a_staging_directory() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        let from = root.path().join("stable");
        let unreadable = from.join("locked");
        fs::create_dir_all(&unreadable).unwrap();
        fs::write(from.join("readable"), b"a").unwrap();
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();

        // Root reads it regardless, and then there is nothing to assert.
        if fs::read_dir(&unreadable).is_ok() {
            fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o755)).unwrap();
            return;
        }

        let to = root.path().join("flavor");
        seed_once(&from, &to);

        assert!(!to.exists(), "a failed seeding must not look finished");
        let leftovers: Vec<_> = fs::read_dir(root.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .filter(|name| name.contains("seeding"))
            .collect();
        assert!(leftovers.is_empty(), "staging left behind: {leftovers:?}");

        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn copy_tree_reports_a_destination_it_cannot_create() {
        let root = tempdir().unwrap();
        let from = root.path().join("stable");
        fs::create_dir_all(&from).unwrap();
        let blocked = root.path().join("blocked");
        fs::write(&blocked, b"file").unwrap();

        assert!(copy_tree(&from, &blocked.join("target")).is_err());
    }
}
