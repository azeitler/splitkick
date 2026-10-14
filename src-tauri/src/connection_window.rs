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

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

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
    ensure_usable_geometry(window);
    window.set_focus().map_err(|error| error.to_string())
}

const DEFAULT_WIDTH: f64 = 1200.0;
const DEFAULT_HEIGHT: f64 = 800.0;
const MIN_WIDTH: f64 = 1000.0;
const MIN_HEIGHT: f64 = 700.0;

/// A frame the user can see and use: at least the minimum size, with its
/// centre on one of the connected monitors.
fn is_usable_frame(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale: f64,
    monitors: &[(PhysicalPosition<i32>, PhysicalSize<u32>)],
) -> bool {
    let logical = size.to_logical::<f64>(scale);
    if logical.width < MIN_WIDTH / 2.0 || logical.height < MIN_HEIGHT / 2.0 {
        return false;
    }
    let center_x = i64::from(position.x) + i64::from(size.width) / 2;
    let center_y = i64::from(position.y) + i64::from(size.height) / 2;
    monitors.iter().any(|(origin, area)| {
        let left = i64::from(origin.x);
        let top = i64::from(origin.y);
        (left..left + i64::from(area.width)).contains(&center_x)
            && (top..top + i64::from(area.height)).contains(&center_y)
    })
}

/// Reset a window that came back 0x0 or off every monitor.
///
/// `tauri-plugin-window-state` restores the saved size and position per label.
/// A state saved on another display layout — or a broken one — can leave a
/// window that exists, and shows in the Window menu, but cannot be seen.
pub fn ensure_usable_geometry(window: &tauri::WebviewWindow) {
    if window.is_minimized().unwrap_or(false)
        || window.is_maximized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
    {
        return;
    }
    let (Ok(position), Ok(size), Ok(scale), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
        window.available_monitors(),
    ) else {
        return;
    };
    let monitors: Vec<_> = monitors
        .iter()
        .map(|monitor| (*monitor.position(), *monitor.size()))
        .collect();
    // No monitor info means nothing to compare against; leave the window alone.
    if monitors.is_empty() || is_usable_frame(position, size, scale, &monitors) {
        return;
    }
    log::warn!(
        "Window '{}' has an unusable frame ({}x{} at {},{}); resetting it",
        window.label(),
        size.width,
        size.height,
        position.x,
        position.y
    );
    let _ = window.set_size(LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    let _ = window.center();
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
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
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
            .hidden_title(true)
            // Centred in the 52pt toolbar; mirrors `trafficLightPosition` in
            // `tauri.conf.json`.
            .traffic_light_position(tauri::LogicalPosition::new(20.0, 20.0));
    }

    builder
}

fn product_name(app: &AppHandle) -> String {
    app.config()
        .product_name
        .clone()
        .unwrap_or_else(|| jean_core::brand::PRODUCT_NAME.to_string())
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
    use super::{is_usable_frame, label_for_connection, REMOTE_LABEL_PREFIX};
    use tauri::{PhysicalPosition, PhysicalSize};

    fn screen() -> Vec<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
        vec![(PhysicalPosition::new(0, 0), PhysicalSize::new(3024, 1964))]
    }

    #[test]
    fn accepts_a_normal_window() {
        assert!(is_usable_frame(
            PhysicalPosition::new(200, 100),
            PhysicalSize::new(2400, 1600),
            2.0,
            &screen()
        ));
    }

    #[test]
    fn rejects_a_zero_size_window() {
        assert!(!is_usable_frame(
            PhysicalPosition::new(200, 100),
            PhysicalSize::new(0, 0),
            2.0,
            &screen()
        ));
    }

    /// Saved on a second display that is no longer connected.
    #[test]
    fn rejects_a_window_off_every_monitor() {
        assert!(!is_usable_frame(
            PhysicalPosition::new(4000, 100),
            PhysicalSize::new(2400, 1600),
            2.0,
            &screen()
        ));
    }

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
