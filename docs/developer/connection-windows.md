# Connection windows

One native window per Jean instance. The main window (`main`) always drives the
local backend; each remote connection gets a window of its own. Switching is a
window focus, not a reload.

## Why

Before this, a remote replaced the local instance inside the single window:
`markConnectionSwitch()` → `selectConnection(id)` → `window.location.reload()`.
Every switch paid for a 12 s pre-probe, a full bundle re-parse, a discarded
Zustand and TanStack Query state, and a serial `/api/auth` → WebSocket →
`/api/init` handshake. The local instance was gone until the user switched
back, at the same price again.

## How a window knows its connection

Rust opens the window at `index.html?connection=<id>` with the label
`remote-<id>`. `readWindowConnection()` in `src/lib/remote-connections.ts`
reads it while the module loads.

**The query parameter is not decoration.** `getActiveRemoteConnection()` is
called from synchronous call sites across the app — `usesWebSocketBackend()` in
`src/lib/transport.ts`, `isLocalBackend()` in `src/lib/environment.ts` — so the
value has to exist at module-init time. A query parameter is the only channel
that qualifies; a Tauri command or `getCurrentWindow()` would need a whole boot
phase. Do not "clean up" the URL: `RemoteConnectionRecovery` reloads the page
every 10 s, and a reload keeps the query string.

The window label is a second source, in case a `history.replaceState` ever
drops the query string (`transport.ts` uses one to strip `?token=`). The Rust
`label_for_connection` and the TypeScript `CONNECTION_WINDOW_LABEL_PREFIX` have
to agree; both sides have a test for it.

## Rules

- **`local` belongs to `main`.** `label_for_connection("local")` returns `None`
  and `activateConnection('local')` focuses `main`. Two windows on one backend
  would both write its UI state (`src/services/ui-state.ts` saves one blob per
  backend) and reap each other's terminals (`App.tsx` boot cleanup).
- **One window per connection.** `open_connection_window` focuses an existing
  window instead of building a second, so the frontend tracks nothing.
- **A pinned id is never checked against the saved list.** Falling back to
  `local` would point a remote window at this machine. `App.tsx` closes the
  window instead when the connection is gone, and the connections dialog closes
  it straight away on delete.
- **A connection window never writes `jean-active-connection`.**
  `selectConnection()` returns early when the window is pinned.
- **Web Access keeps the old behaviour.** A browser has one browsing context
  and no windows, so `activateConnection` still swaps and reloads there.

## Window setup lives in two places

`tauri.conf.json` describes `main`. A window built at runtime does **not** read
`app.windows[0]`, so `connection_window::build()` repeats `minInnerSize`,
`titleBarStyle`, `hiddenTitle` and the drag-drop handler. Keep them in step.

Everything else a Jean window needs — Linux decorations, the Linux file-drop
handler, the vibrancy preference — lives in `configure_app_window()` in
`src-tauri/src/lib.rs`, which runs for `main` during setup and for every
connection window right after it is built.

## Menu events

The macOS menu belongs to the application, so `install_menu_events` sends each
event to the focused window's label with `emit_to`.

**`emit_to` alone does nothing.** A listener registered as `EventTarget::Any`
short-circuits every emit filter, and JS `listen(event, cb)` with no options
registers exactly that. The frontend half is `listenMenu()` in
`src/lib/transport.ts`, which passes the current window label as the target.
Both halves are required.

## Adding a window-scoped Tauri command

Take `window: tauri::Window` (or `WebviewWindow`) as a parameter instead of
reaching for `app.get_webview_window("main")`. Tauri injects the caller. See
`browser_create` and `set_window_vibrancy`.

New window labels also need a capability entry — `capabilities/default.json`
and `desktop.json` list `["main", "remote-*"]`.

## Known limits

- `localStorage` is shared between windows but is not live-synced: the module
  keeps an in-process snapshot and there is no `storage` listener. An edit in
  one window leaves the other's list stale until it reloads. Do not add a
  `storage` listener — cross-webview delivery on WKWebView is not dependable.
- Zoom and theme come from the connected backend's preferences, so two windows
  can differ. Pre-existing; only newly visible.
- `browser:*` events still broadcast to every window. Tab ids are UUIDs, so the
  other window's handler finds no tab and does nothing.
- On Windows a notification click focuses `main` whichever window raised it.
