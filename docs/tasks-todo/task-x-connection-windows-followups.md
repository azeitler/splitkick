# Connection windows — follow-ups

The feature shipped in `docs/developer/connection-windows.md`
([azeitler#26](https://github.com/azeitler/jean/issues/26)). These were left
out on purpose.

## Windows notification click focuses the wrong window

`restore_main_window` in `src-tauri/src/platform/notifications.rs` always
focuses `main`. A toast raised by a connection window should focus that window.
Thread the origin label through `send_native_notification`
(`src-tauri/src/desktop_commands.rs`). Windows-only path; needs a Windows
machine to verify. Degrades to "focuses the wrong window", never a crash.

## WebView2 crash recovery is main-only

`platform::install_process_failed_recovery` in `src-tauri/src/lib.rs` installs
the WebView2 process-death handler for the whole app during setup (issue #575).
Confirm it covers a window built later, and if not, install it per window from
`configure_app_window`.

## `browser-pane.json` grants what it says it forbids

`src-tauri/src/capabilities/browser-pane.json` scopes `webviews: ["browser-*"]`
with no permissions, and its comment claims a pane has no IPC. But
`capabilities/default.json` lists the parent window, and the ACL check is an OR
over windows and webviews, so `browser-*` child webviews already inherit
everything. Either scope `default.json` to the window's own webview label or
correct the comment. Pre-existing; not made worse by connection windows.

## The connection-switch marker is dead on the native path

`markConnectionSwitch` / `isConnectionSwitchPending` / `clearConnectionSwitch`
exist to suppress `kill_all_terminals` across a switch reload. Only Web Access
still reloads, and both guards in `src/App.tsx` already short-circuit there on
`webBackend`. Worth removing once the window behaviour has settled.
