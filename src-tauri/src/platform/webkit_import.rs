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
