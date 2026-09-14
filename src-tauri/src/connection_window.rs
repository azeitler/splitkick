//! Native windows for remote Jean connections.
//!
//! The desktop shell keeps `main` on the local backend and gives every remote
//! connection a window of its own, so switching is a window focus instead of a
//! full reload of the single window.
//!
//! A window is pinned to its connection through `index.html?connection=<id>`.
//! The frontend reads that query parameter when `remote-connections.ts` loads —
//! the only channel available synchronously at module-init time, which the
//! transport layer needs. The label is the same id behind `remote-`, and the
//! frontend falls back to it if the query string is ever lost.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The window that always drives the local backend.
pub const MAIN_WINDOW: &str = "main";
/// Label prefix for a connection window. Mirrored by
/// `CONNECTION_WINDOW_LABEL_PREFIX` in `src/lib/remote-connections.ts`.
pub const REMOTE_LABEL_PREFIX: &str = "remote-";

/// Id used by the frontend for "no remote"; it belongs to [`MAIN_WINDOW`].
const LOCAL_CONNECTION_ID: &str = "local";

/// Window label for a connection id, or `None` when the id cannot be one.
///
/// Connection ids are generated UUIDs, so this only rejects a hand-edited
/// `localStorage` entry — which would otherwise reach both a window label and
/// a URL.
pub fn label_for_connection(connection_id: &str) -> Option<String> {
    let usable = !connection_id.is_empty()
        && connection_id != LOCAL_CONNECTION_ID
        && connection_id.len() <= 64
        && connection_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    usable.then(|| format!("{REMOTE_LABEL_PREFIX}{connection_id}"))
}

fn focus(window: &tauri::WebviewWindow) -> Result<(), String> {
    let _ = window.unminimize();
    let _ = window.show();
    window.set_focus().map_err(|error| error.to_string())
}

/// Window options that `tauri.conf.json` gives the main window.
///
/// A window built at runtime does not read `app.windows[0]`, so these have to
/// be repeated here. Keep them in step with `tauri.conf.json` and its overlays.
fn build<'a>(
    app: &'a AppHandle,
    label: &'a str,
    url: WebviewUrl,
    title: String,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .inner_size(1200.0, 800.0)
        .min_inner_size(1000.0, 700.0)
        .resizable(true)
        .center()
        .shadow(true)
        // Jean handles drops in HTML; Tauri's native drop swallows those events.
        // Mirrors `"dragDropEnabled": false` in `tauri.conf.json`.
        .disable_drag_drop_handler();

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    builder
}

fn product_name(app: &AppHandle) -> String {
    app.config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Jean".to_string())
}

/// Open the window for a remote connection, or focus it when it already exists.
#[tauri::command]
pub async fn open_connection_window(
    app: AppHandle,
    connection_id: String,
    title: Option<String>,
) -> Result<String, String> {
    let label = label_for_connection(&connection_id)
        .ok_or_else(|| format!("'{connection_id}' cannot have a window of its own"))?;

    if let Some(existing) = app.get_webview_window(&label) {
        focus(&existing)?;
        return Ok(label);
    }

    let url = WebviewUrl::App(format!("index.html?connection={connection_id}").into());
    let title = title
        .map(|title| title.trim().to_string())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| product_name(&app));

    let window = build(&app, &label, url, title)
        .build()
        .map_err(|error| error.to_string())?;
    crate::configure_app_window(&window);
    Ok(label)
}

/// Bring the local window to the front, recreating it when it was closed.
#[tauri::command]
pub async fn focus_main_window(app: AppHandle) -> Result<(), String> {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => focus(&window),
        None => recreate_main_window(&app),
    }
}

/// Ids of the connections that currently have a window open.
///
/// The connections dialog uses this to mark which remotes are already on
/// screen, and to decide whether an edited connection needs its window rebuilt.
#[tauri::command]
pub async fn list_connection_windows(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(app
        .webview_windows()
        .keys()
        .filter_map(|label| label.strip_prefix(REMOTE_LABEL_PREFIX))
        .map(str::to_string)
        .collect())
}

/// Close a connection's window, if it has one. Used when the connection is
/// deleted or edited, so a stale window never keeps talking to the old URL.
#[tauri::command]
pub async fn close_connection_window(app: AppHandle, connection_id: String) -> Result<(), String> {
    let Some(label) = label_for_connection(&connection_id) else {
        return Ok(());
    };
    if let Some(window) = app.get_webview_window(&label) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Build `main` again after the user closed it. Running sessions can hold the
/// app alive with no windows left, and then there is no way back in.
pub fn recreate_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        return focus(&window);
    }
    let title = product_name(app);
    let window = build(
        app,
        MAIN_WINDOW,
        WebviewUrl::App("index.html".into()),
        title,
    )
    .build()
    .map_err(|error| error.to_string())?;
    crate::configure_app_window(&window);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{label_for_connection, REMOTE_LABEL_PREFIX};

    #[test]
    fn builds_a_label_from_a_connection_id() {
        assert_eq!(
            label_for_connection("6f1c2b7e-8b1d-4c63-9a5e-2f0a7c9d1e33"),
            Some("remote-6f1c2b7e-8b1d-4c63-9a5e-2f0a7c9d1e33".to_string())
        );
    }

    /// `remote-connections.ts` strips the prefix to recover the id, so the two
    /// halves have to agree.
    #[test]
    fn the_label_keeps_the_id_recoverable() {
        let id = "abc_123-XYZ";
        let label = label_for_connection(id).expect("label");
        assert_eq!(label.strip_prefix(REMOTE_LABEL_PREFIX), Some(id));
    }

    #[test]
    fn rejects_an_id_that_cannot_be_a_label() {
        for id in ["", "../etc", "a b", "a/b", "id?x=1", &"x".repeat(65)] {
            assert_eq!(label_for_connection(id), None, "accepted {id:?}");
        }
    }

    /// The local backend belongs to `main`. Two windows on one backend would
    /// both write its UI state and reap each other's terminals.
    #[test]
    fn local_never_gets_a_window_of_its_own() {
        assert_eq!(label_for_connection("local"), None);
    }
}
