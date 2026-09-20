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

## Links inside a browser tab

`browser_create` gives every tab two handlers, because a tab is a bare child
webview with no window of its own:

- `on_new_window`: a link with `target="_blank"` and `window.open()` ask WebKit
  for a window. Jean denies the window and emits `browser:new-tab` with the
  opener's tab id; `useBrowserEvents` adds the URL as a tab beside the opener.
  **Without this handler wry denies the request itself and the click does
  nothing at all** — the tab would look broken on any site whose links open in
  a new tab.
- `on_navigation`: a URL the pane cannot render (`mailto:`, `tel:`, an app deep
  link — see `is_pane_scheme`) is cancelled and handed to the OS with
  `open_url_in_browser`, as a normal browser does. `http`, `https`, `file`,
  `about`, `data` and `blob` load in the tab.

## Links in chat responses

The markdown renderer sends every link through `MarkdownLink`
(`src/components/ui/markdown-link.tsx`), which calls `openChatLink()` from
`src/lib/chat-links.ts`:

| Link                         | Click                        | Cmd/Ctrl-click or ↗ button |
| ---------------------------- | ---------------------------- | -------------------------- |
| http(s) URL                  | embedded browser             | system browser             |
| local file the pane can show | embedded browser (`file://`) | OS default app             |
| other local file             | file viewer                  | file viewer                |

- In web access (no native webview) web links open a browser tab and local
  pages open in the file viewer. Without the local backend, local pages also
  use the file viewer. The ↗ button shows only where the embedded browser is
  available.
- When no browser surface exists, the click falls back to the system browser.
- The message context menu offers **Open in Default Browser** for a web link,
  and for a local HTML page when the backend is local
  (`src/components/chat/message-thread-context-menu.tsx`). It reads the raw
  `href` attribute, not `anchor.href`, because a relative path must resolve
  against the worktree and not against the app's own origin.
- These anchors carry `data-chat-link`, so `useExternalLinkInterceptor` skips
  them. Every other anchor in the app still opens in the system browser.
- `remarkLocalFileLinks` (`src/lib/remark-local-file-links.ts`) turns paths in
  plain text, and inline code that holds exactly one path, into links.
  `markdownUrlTransform` keeps `file:` and drive-letter hrefs, which
  react-markdown would otherwise blank. Two limits are deliberate:
  - **No spaces.** Neither prose nor inline code can tell `open a/b.html` (a
    command) from `04 report.html` (a name). Write a name with a space as a
    real markdown link: `[04 report.html](<04 report.html>)`.
  - **`#` and `?` in a name work in inline code only.** `splitFileRefSuffix()`
    decides whether they start a fragment or belong to the name: if the part
    before the first one is already browsable it is a suffix, otherwise the
    whole string is the name. `chat-links.ts` uses the same rule, so the
    classifier and the opener never disagree.

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

`isBrowsableFile()` in the same module decides which files the Files sidebar
and chat links open in the browser. `isHtmlFile()` covers the page extensions
alone (`.html`, `.htm`, `.xhtml`, `.xht`, `.shtml`). `isPaneTextUrl()` decides
which of the two renderers a tab gets — see "Text files" below.

## What the pane renders, and what it reports

Checked with a headless `WKWebView` that loads each type from disk and prints
`canShowMIMEType`, the navigation callback and `document.contentType`:

| Type                                    | Result                                    |
| --------------------------------------- | ----------------------------------------- |
| `.html` `.htm` `.xhtml` `.xht` `.shtml` | page, load finishes normally              |
| `.pdf`                                  | built-in PDF view, load finishes          |
| images incl. `.svg`                     | image document, load finishes             |
| `.txt` `.md` `.log`                     | plain-text document — React renders these |
| movies                                  | player appears, load reports **failure**  |

Two findings drive code:

- **A movie never finishes.** WebKit replaces the page with a media document
  and reports `WebKitErrorDomain 204 "Plug-in handled load"`, so `on_page_load`
  fires Started and never Finished. `useBrowserEvents` therefore treats a
  `browser:loading` event for an `isVideoFile()` URL as a finished load.
- **The web view is the wrong renderer for text.** It shows a Markdown file as
  its own source, and a `file://` response carries no charset, so WebKit falls
  back to Latin-1 and `# Notes — draft` in a UTF-8 `.md` shows as `â€"`. HTML
  is fine, because the document declares its own encoding. Text therefore never
  reaches the web view; see below.

## Text files

`BrowserTabContent` is a router. `isPaneTextUrl(url)` — a `file://` URL naming
a `.md`, `.markdown`, `.txt`, `.text` or `.log` — sends the tab to
`BrowserTextContent`, which reads the file with `read_file_content` and renders
it with Jean's own `Markdown` component (or a `<pre>` for plain text). Every
other URL keeps the native child web view. A Markdown file served over http(s)
stays with the web view: the user asked for a web page there.

No web view exists for a text tab, which is what lets its DOM show — a web view
paints over the DOM beside it. Switching between the two modes needs no extra
work: leaving text mounts the web view body, which finds no web view for the
tab and creates one with the new URL; entering text unmounts it, and its
cleanup parks the web view off-screen and hides it.

Consequences elsewhere:

- `navigateBrowserTab` does not call `browser_navigate` for a text URL. It
  bumps `reloadTab`, so the file is read again even when the URL did not
  change. It also skips the call when the tab owns no web view yet.
- `useBrowserTabActions.reload` bumps `reloadTab` instead of calling
  `browser_reload`. `BrowserView`'s error overlay Retry goes through it.
- `BrowserToolbar` disables Back, Forward and Grab for a text tab.
- `BrowserTextContent` writes the tab's loading and error state, so the tab
  pill spinner and the error overlay work the same for both renderers.

## Why a load must never hang

wry exposes only Started and Finished. A load that fails after it starts — a
missing file, a dead link clicked inside a page — produces neither a Finished
event nor any error callback, so a tab that only listens for Finished spins for
ever. Three defences, in order of precision:

1. `reject_missing_local_file()` in `src-tauri/src/browser/commands.rs` checks
   a `file://` path in `browser_create` and `browser_navigate` and returns an
   error that names the file. `BrowserTabContent` puts a failed `browser_create`
   into the tab's error overlay instead of only logging it.
2. `useBrowserEvents` arms the watchdog on **every** started load, not only one
   the URL bar asked for, so a silent failure becomes an error after 20 s.
3. The existing about:blank check still catches the redirect-to-blank failures.

Test fixtures for all of this live in `scratch/browser-fixtures/` (git-ignored):
one page per case, each printing whether its CSS, JS and relative assets
loaded.
