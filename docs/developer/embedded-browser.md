# Embedded Browser: Opening URLs

Jean's embedded browser is a set of native Tauri child Webviews, one per tab.
Tabs belong to a worktree (`useBrowserStore.tabs[worktreeId]`) and show in one
of three surfaces: the main window side pane, the bottom panel, or the session
chat modal's drawer. For the DOM selection bridge, see
[embedded-browser-grab.md](embedded-browser-grab.md).

## Open a URL from another feature

Call `openUrlInEmbeddedBrowser(url)` from `src/hooks/useBrowserPane.ts`. Do not
add tabs and open surfaces by hand.

```ts
import { openUrlInEmbeddedBrowser } from '@/hooks/useBrowserPane'

const opened = await openUrlInEmbeddedBrowser(url)
if (!opened) toast.error('Open a session first to browse this file')
```

It:

1. Picks the surface with `resolveBrowserSurfaceTarget()` — the session modal
   drawer when that modal is open, otherwise the side pane of the active
   worktree. The `toggle_browser` keybinding uses the same resolver, so both
   always agree.
2. Reuses a tab that already shows the URL. If that tab's webview exists, it
   navigates it again, which reloads the page. Otherwise it only activates the
   tab; the webview loads the URL when it mounts.
3. Otherwise adds a new tab with the URL. A new tab creates its webview on mount
   from `tab.url`, so it needs no `browser_navigate` call.
4. Opens the surface. It returns `false` when no surface exists — for example
   on the project canvas with no session open — so the caller can tell the
   user.

To navigate a tab whose webview is alive, use `navigateBrowserTab(tabId, url)`.
It keeps the URL bar, loading state, watchdog, and error overlay consistent
with the toolbar.

## Local files

Convert a path with `toFileUrl()` from `src/lib/path-utils.ts`. It encodes each
path segment on its own, so `#`, `?` and spaces stay part of the path and
relative links in the page (`css/site.css`) resolve next to it. It also handles
Windows drive paths and UNC paths.

Loading `file://` URLs works without a custom protocol or a wider asset scope:

- Tauri passes a `WebviewUrl::External` file URL through unchanged, and wry
  loads every URL with `WKWebView loadRequest:`.
- WebKit grants the web content process read access for a file URL loaded that
  way. This was verified with a standalone `WKWebView` probe on macOS: the page
  loaded, and a stylesheet and a script from a subfolder loaded too.

Gate file browsing on `isLocalBackend()`, not `isNativeApp()`. With a remote
Jean backend, the worktree path names a file on the other machine, and the
local webview would load the wrong file or nothing.

`isHtmlFile()` in the same module decides which files the Files sidebar opens
in the browser: `.html`, `.htm`, `.xhtml`, `.xht` and `.shtml`.
