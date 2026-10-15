//! Copy JeanZ's or Jean's per-app stores after an import (macOS).
//!
//! Two stores follow the bundle identifier, not the data folder, so the data
//! import cannot carry them:
//!
//! - `~/Library/WebKit/<identifier>`: `localStorage` with the remote-host
//!   list, the client zoom and the client preferences. The per-origin folder
//!   names inside are hashed from the origin and a salt that travels with the
//!   tree, so a whole-tree copy lands `localStorage` where the WebView looks.
//! - `~/Library/HTTPStorages/<identifier>.binarycookies`: cookies, e.g. logins
//!   in the browser pane.
//! - The macOS defaults domain (`~/Library/Preferences/<identifier>.plist`):
//!   Open/Save dialog size and last folder, panel positions. Copied with
//!   `defaults export` / `defaults import`, because `cfprefsd` caches the
//!   plist and would ignore or overwrite a plain file copy.
//!
//! Each store follows the import chain: JeanZ's copy if it exists, otherwise
//! Jean's (`jean_core::jean_import::SOURCE_IDENTIFIERS`). The copy runs on the
//! start that applies the import, before the main window and its WebView
//! exist. What the fresh install had already created is kept in
//! `<data>/.pre-import/`. Best effort: a failure leaves the store as it is.

use std::path::{Path, PathBuf};

use jean_core::jean_import::{copy_entry, first_existing, ImportSummary, SOURCE_IDENTIFIERS};

pub fn import_app_stores(identifier: &str, data_dir: &Path) {
    let Some(library) = dirs::home_dir().map(|home| home.join("Library")) else {
        return;
    };
    let webkit = library.join("WebKit");
    import_store(
        SOURCE_IDENTIFIERS.iter().map(|id| webkit.join(id)),
        webkit.join(identifier),
        &data_dir.join(".pre-import").join("webkit"),
    );
    let cookies = library.join("HTTPStorages");
    import_store(
        SOURCE_IDENTIFIERS
            .iter()
            .map(|id| cookies.join(format!("{id}.binarycookies"))),
        cookies.join(format!("{identifier}.binarycookies")),
        &data_dir.join(".pre-import").join("cookies.binarycookies"),
    );
    import_defaults(&library.join("Preferences"), identifier, data_dir);
}

/// Copy the first existing source's defaults domain into `identifier`'s.
/// The fresh install's own domain is exported to `.pre-import/` first.
fn import_defaults(preferences: &Path, identifier: &str, data_dir: &Path) {
    let Some(source) = SOURCE_IDENTIFIERS
        .iter()
        .find(|id| preferences.join(format!("{id}.plist")).is_file())
    else {
        return;
    };
    let kept = data_dir.join(".pre-import").join("defaults.plist");
    if preferences.join(format!("{identifier}.plist")).is_file() {
        let _ = std::fs::create_dir_all(data_dir.join(".pre-import"));
        let _ = defaults(&["export", identifier, &kept.to_string_lossy()]);
    }
    let exported = data_dir.join(".pre-import").join("imported-defaults.plist");
    let _ = std::fs::create_dir_all(data_dir.join(".pre-import"));
    if let Err(error) = defaults(&["export", source, &exported.to_string_lossy()])
        .and_then(|()| defaults(&["import", identifier, &exported.to_string_lossy()]))
    {
        eprintln!("Import: could not copy the {source} defaults: {error}");
    }
    let _ = std::fs::remove_file(&exported);
}

fn defaults(args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/defaults")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Replace `dest` with a copy of the first existing source.
fn import_store(sources: impl Iterator<Item = PathBuf>, dest: PathBuf, kept: &Path) {
    let Some(source) = first_existing(sources) else {
        return;
    };
    if dest.exists() {
        if let Some(parent) = kept.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::remove_dir_all(kept);
        let _ = std::fs::remove_file(kept);
        if let Err(error) = std::fs::rename(&dest, kept) {
            eprintln!("Import: could not set aside {}: {error}", dest.display());
            return;
        }
    }
    let mut summary = ImportSummary::default();
    if let Err(error) = copy_entry(&source, &dest, &mut summary) {
        eprintln!("Import: could not copy {}: {error}", source.display());
    }
}
