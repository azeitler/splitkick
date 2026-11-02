# HTML and SVG Artifact Preview

Agents write HTML pages and SVG files (reports, dashboards, mock-ups,
diagrams). Splitkick shows them rendered (#76):

- **File viewer** (`src/components/chat/FileContentModal.tsx`): `.html`,
  `.htm` and `.svg` files open as a preview, with **Source**, **Reload** and
  **Open in Browser**. It opens from tool calls, the file browser, file links
  and attached file pills (`FilePreview.tsx`).
- **Pasted attachments** (`TextFilePreview.tsx`): a pasted `.svg` or `.html`
  attachment opens as a preview, with **Source**.
- **Chat code blocks**: ` ```html ` and ` ```svg ` blocks stay code blocks
  and get a **Preview** button (registry mode `preview` in
  `src/components/ui/code-block-renderers.ts`, renderer
  `src/components/ui/rich-blocks/HtmlPreviewBlock.tsx`). Nothing renders
  without a click, and not while the message streams.

The sandbox lives in `src/components/artifact-preview/`.

## Threat model

**The content is untrusted.** An agent can write any HTML, also by prompt
injection from a web page, an issue or a dependency it read. The page may try
to:

1. call Tauri commands (run shell commands, read and write files),
2. read the app's DOM, `localStorage`, cookies or the Web Access token,
3. send data out over the network (fetch, images, WebSocket, beacons),
4. navigate the app window, open pop-ups, submit forms (phishing),
5. talk to the app with `postMessage`.

**Out of scope:** the user's own choice to open the file in the system
browser (**Open in Browser**), where the page runs like any local file;
resource abuse (an endless loop freezes only the frame's process, where the
browser isolates it, and the user closes the viewer).

## Controls

| Control                                                                                                                                                                                                          | Where                            | Stops                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox="allow-scripts"`, **no** `allow-same-origin`                                                                                                                                                            | `PREVIEW_IFRAME_SANDBOX`         | 1, 2: the frame has an opaque origin (`null`), so `parent`/`top` DOM, `__TAURI_INTERNALS__`, storage, cookies and IndexedDB all throw.                                    |
| No `allow-top-navigation`, `allow-popups`, `allow-forms`, `allow-modals`                                                                                                                                         | same                             | 4                                                                                                                                                                         |
| Web Access: content via `srcdoc`. Native app: the `splitkick-artifact:` origin (below). Never a file or backend URL                                                                                              | `SandboxedHtmlFrame`             | The page has no URL of its own to reload with more rights.                                                                                                                |
| CSP meta tag first in the document: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'` | `buildSandboxedSrcdoc`           | 3: no fetch, XHR, WebSocket, external image, script, style or font. No `eval`. The page can add own policies, but every extra policy only restricts more.                 |
| `referrerpolicy="no-referrer"`                                                                                                                                                                                   | frame                            | Leaks no app URL.                                                                                                                                                         |
| SVG as `<img src="data:image/svg+xml;base64,…">`                                                                                                                                                                 | `SvgPreview`, `FileContentModal` | 1–5: browsers run no script and load no external resource in an SVG used as image. Interactive (scripted) SVGs show static, which is the safe default.                    |
| The only `message` listener is `SandboxedHtmlFrame`'s: it accepts only `splitkick-artifact-ready`, only from `event.source === its own frame`, and answers once                                                  | `SandboxedHtmlFrame`             | 5: other frame messages arrive with origin `null` and nothing acts on them. **Do not add a `message` listener that trusts `event.data` without checking `event.source`.** |

### Native app: the `splitkick-artifact:` origin

A `srcdoc` document inherits the parent's CSP in addition to its own. Release
builds add `'sha256-…'` hashes for every JS file and inline script to the
app's `script-src` ([Tauri CSP docs](https://v2.tauri.app/security/csp/);
`inject_script_hashes` in `tauri-codegen`). With a hash present, browsers
ignore `'unsafe-inline'`, so inline scripts in a `srcdoc` preview would not
run in the release app (dev builds load from `devUrl` and do not show this;
the e2e test `srcdoc under a release-like app CSP runs no inline script`
does).

So the native app frames `splitkick-artifact://localhost/frame`
(`http://splitkick-artifact.localhost/frame` on Windows/Android), a URI
scheme the app registers (`src-tauri/src/artifact_preview.rs`):

- The response is one fixed bootstrap page
  (`artifact_preview_bootstrap.html`) with the same CSP as above plus
  `sandbox allow-scripts`, so the document has an opaque origin even without
  the frame attribute. No artifact content ever reaches Rust.
- The bootstrap posts `splitkick-artifact-ready`. `SandboxedHtmlFrame` answers
  once, only to `event.source === its own frame`, with the page; the bootstrap
  accepts one message from `parent` and `document.write`s it. The document
  keeps the response's CSP and sandbox.
- The app CSP allows the scheme in `frame-src` (`tauri.conf.json`). That
  `frame-src` also stops a preview from navigating its frame to a web page.

### Tauri IPC

Tauri v2 does not inject its IPC script into sub-frames, and a frame that
Tauri did not initialize cannot send IPC messages: the fix of
[GHSA-57fm-592m-34r7 / CVE-2024-35222](https://github.com/advisories/GHSA-57fm-592m-34r7)
(Tauri 2.0.0-beta.20) and the invoke key. The sandbox does not depend on
that: with an opaque origin, the frame cannot read `parent.__TAURI_INTERNALS__`
either, and the `splitkick-artifact:` origin has no capability. The
[Isolation pattern](https://v2.tauri.app/concept/inter-process-communication/isolation/)
is about checking the app's own IPC calls and does not apply here.

### Residual risk

- **Self-navigation in a browser.** In Web Access the web UI sends no CSP, so
  a preview script can navigate _its own frame_ (`location.href = …`) and
  carry the data it holds in the URL. The frame holds only the artifact
  itself, never app data. Native app: blocked by the app's `frame-src`.
- **DNS prefetch** hints are not covered by CSP in every engine.

### Open in Browser

`openFileInBrowser` (`open-in-browser.ts`):

- **Local desktop:** the OS opens the file (`open_path_in_default_app`).
- **Remote backend / Web Access:** the backend's preview URL
  (`/preview/<root>/<sig>/…`, `jean-core/src/http_server/server.rs`). That
  response carries `Content-Security-Policy: sandbox allow-scripts …`, so the
  page gets an opaque origin and cannot read the web UI's token. The
  pre-opened tab gets `opener = null`.

## Tests

- `src/components/artifact-preview/*.test.ts(x)`: sandbox token, CSP, srcdoc
  order, SVG as image, open-in-browser paths.
- `src/components/ui/code-block-renderers.test.tsx`: chat Preview action.
- `e2e/tests/artifact-sandbox.spec.ts`: real Chromium, for the Web Access
  `srcdoc` frame and for the native bootstrap page on its own origin under a
  release-like app CSP. The attack page
  `e2e/fixtures/sandbox-escape.html` tries fetch, WebSocket, images, external
  script, `sendBeacon`, `parent`/`top` DOM, `__TAURI_INTERNALS__`, storage,
  cookies, `window.open`, top navigation, `eval` and `postMessage`; all must
  fail, and no request may reach the network. Open the same file in the
  native app's file viewer to check WKWebView/WebView2: every line must say
  "blocked".
