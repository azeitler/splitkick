//! System-wide `splitkick://` links.
//!
//! Only `splitkick://connect?url=<Web Access URL>&token=<token>[&name=<name>]`
//! does something today: it opens the Server connections dialog in the main
//! window with "Add remote" filled in. Nothing is saved until the user clicks
//! Save & Connect, so a clicked link can never add a server on its own.
//!
//! The link is parked here and the main window takes it
//! (`take_pending_connection_link`). That covers every timing: a cold start
//! (the page is not loaded yet), a main window that was closed and is rebuilt,
//! and a running app (it gets `connections:link` and takes it at once).

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::connection_window::{self, MAIN_WINDOW};

/// Sent to `main` when a connect link arrived while the app ran.
const CONNECTION_LINK_EVENT: &str = "connections:link";

/// The last connect link nobody has taken yet.
#[derive(Default)]
pub struct PendingConnectionLink(Mutex<Option<String>>);

/// Whether `url` is a connect link (`<scheme>://connect?…`).
fn is_connect_link(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|host| host.eq_ignore_ascii_case("connect"))
}

fn park(app: &AppHandle, urls: &[Url]) -> bool {
    let Some(link) = urls.iter().rev().find(|url| is_connect_link(url)) else {
        return false;
    };
    let state = app.state::<PendingConnectionLink>();
    if let Ok(mut pending) = state.0.lock() {
        *pending = Some(link.to_string());
    }
    true
}

/// Register the link handlers. Call once from `setup`.
pub fn setup(app: &tauri::App) {
    app.manage(PendingConnectionLink::default());

    // Windows and Linux AppImage builds do not register the scheme at install
    // time; this points it at the running executable.
    #[cfg(any(windows, target_os = "linux"))]
    if let Err(error) = app.deep_link().register_all() {
        log::warn!("Failed to register splitkick:// links: {error}");
    }

    // The link that started the app. The page loads later and takes it.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        park(app.handle(), &urls);
    }

    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        if !park(&handle, &event.urls()) {
            return;
        }
        let focused = connection_window::show_main_window(&handle);
        if let Err(error) = focused {
            log::warn!("Failed to show the main window for a link: {error}");
        }
        // A rebuilt main window misses this; it takes the link when it loads.
        let _ = handle.emit_to(MAIN_WINDOW, CONNECTION_LINK_EVENT, ());
    });
}

/// The pending connect link, once. `None` when there is none.
#[tauri::command]
pub async fn take_pending_connection_link(app: AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<PendingConnectionLink>();
    let mut pending = state.0.lock().map_err(|error| error.to_string())?;
    Ok(pending.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_connect_links_count() {
        let connect = Url::parse("splitkick://connect?url=http%3A%2F%2Fh%3A3456").unwrap();
        let session = Url::parse("splitkick://session/abc").unwrap();
        assert!(is_connect_link(&connect));
        assert!(!is_connect_link(&session));
    }
}
