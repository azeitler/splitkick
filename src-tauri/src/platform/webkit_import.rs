//! Copy Jean's WebKit website data store after an import (macOS).
//!
//! The WebKit store under `~/Library/WebKit/<bundle identifier>` holds
//! `localStorage`: the remote-host list, the client zoom and the client
//! preferences. It follows the bundle identifier, so the import copies it
//! from Jean (or JeanZ) on the start that applies the import — before the
//! main window, and with it the WebView, exists. The per-origin folder names
//! inside are hashed from the origin and a salt that travels with the tree,
//! so a whole-tree copy lands `localStorage` where the WebView looks.

use std::path::Path;

/// Replace this app's WebKit store with a copy of `source_identifier`'s.
/// The store the fresh install had already created is kept in
/// `<data>/.pre-import/webkit`. Best effort: a failure leaves the store as is.
pub fn import_webkit_store(source_identifier: &str, identifier: &str, data_dir: &Path) {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let webkit = home.join("Library").join("WebKit");
    let source = webkit.join(source_identifier);
    let dest = webkit.join(identifier);
    if !source.is_dir() {
        return;
    }
    if dest.exists() {
        let kept = data_dir.join(".pre-import").join("webkit");
        let _ = std::fs::create_dir_all(data_dir.join(".pre-import"));
        let _ = std::fs::remove_dir_all(&kept);
        if let Err(error) = std::fs::rename(&dest, &kept) {
            eprintln!("Import: could not set aside {}: {error}", dest.display());
            return;
        }
    }
    let mut summary = jean_core::jean_import::ImportSummary::default();
    if let Err(error) = jean_core::jean_import::copy_entry(&source, &dest, &mut summary) {
        eprintln!("Import: could not copy the WebKit store: {error}");
    }
}
