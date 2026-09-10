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

To open a URL in a given worktree that may not be on screen, use
`openUrlInWorktreeBrowser(worktreeId, url)`. When that worktree's surface is
visible it calls `openUrlInEmbeddedBrowser`; otherwise it adds (or activates)
the tab in that worktree and marks its side pane open, so the page is there
when the user goes to the worktree.

## Links in chat responses

The markdown renderer sends every link through `MarkdownLink`
(`src/components/ui/markdown-link.tsx`), which calls `openChatLink()` from
`src/lib/chat-links.ts`:

| Link                           | Click                        | Cmd/Ctrl-click or ↗ button |
| ------------------------------ | ---------------------------- | -------------------------- |
| http(s) URL                    | embedded browser             | system browser             |
| local HTML file (`isHtmlFile`) | embedded browser (`file://`) | OS default app             |
| other local file               | file viewer                  | file viewer                |

- In web access (no native webview) web links open a browser tab and local
  pages open in the file viewer. Without the local backend, local pages also
  use the file viewer. The ↗ button shows only where the embedded browser is
  available.
- When no browser surface exists, the click falls back to the system browser.
- These anchors carry `data-chat-link`, so `useExternalLinkInterceptor` skips
  them. Every other anchor in the app still opens in the system browser.
- `remarkLocalHtmlLinks` (`src/lib/remark-local-html-links.ts`) turns HTML paths
  in plain text, and inline code that holds exactly one such path, into links.
  `markdownUrlTransform` keeps `file:` and drive-letter hrefs, which
  react-markdown would otherwise blank.

## Jean MCP `open_in_browser`

Agents can show a page themselves with the `open_in_browser` tool
(`jean-core/src/jean_mcp_core.rs`). It takes `url` (http(s) URL, `file://` URL,
absolute path, or worktree-relative path) and an optional `worktreeId`
(defaults to the calling session's worktree). Local files must exist; other
schemes are refused. The tool emits `browser:open-url` with either `url` or
`path`; `useBrowserEvents` turns a path into a `file://` URL (local backend
only) and calls `openUrlInWorktreeBrowser`. The tool is rate-limited.

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
