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

| Control                                                                                                                                                                                                                                                                 | Where                            | Stops                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sandbox="allow-scripts"`, **no** `allow-same-origin`                                                                                                                                                                                                                   | `PREVIEW_IFRAME_SANDBOX`         | 1, 2: the frame has an opaque origin (`null`), so `parent`/`top` DOM, `__TAURI_INTERNALS__`, storage, cookies and IndexedDB all throw.                                                                                                                       |
| No `allow-top-navigation`, `allow-popups`, `allow-forms`, `allow-modals`                                                                                                                                                                                                | same                             | 4                                                                                                                                                                                                                                                            |
| Web Access: content via `srcdoc`. Native app: the loopback origin (below). Never a file or backend URL                                                                                                                                                                  | `SandboxedHtmlFrame`             | The page has no URL of its own to reload with more rights.                                                                                                                                                                                                   |
| CSP meta tag first in the document: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'`                                                        | `buildSandboxedSrcdoc`           | 3: no fetch, XHR, WebSocket, external image, script, style or font. No `eval`. The page can add own policies, but every extra policy only restricts more.                                                                                                    |
| `referrerpolicy="no-referrer"`                                                                                                                                                                                                                                          | frame                            | Leaks no app URL.                                                                                                                                                                                                                                            |
| SVG as `<img src="data:image/svg+xml;base64,…">`                                                                                                                                                                                                                        | `SvgPreview`, `FileContentModal` | 1–5: browsers run no script and load no external resource in an SVG used as image. Interactive (scripted) SVGs show static, which is the safe default.                                                                                                       |
| The only `message` listeners are `SandboxedHtmlFrame`'s: `splitkick-artifact-ready` (answered once) and, for chat blocks, `splitkick-artifact-size` (a finite height the caller clamps to 120 px … 70 % of the window); both only from `event.source === its own frame` | `SandboxedHtmlFrame`             | 5: other frame messages arrive with origin `null` and nothing acts on them. A forged size message can only change the height of its own box, within the clamp. **Do not add a `message` listener that trusts `event.data` without checking `event.source`.** |

### Native app: the loopback origin

A `srcdoc` document inherits the parent's CSP in addition to its own. Release
builds add `'sha256-…'` hashes for every JS file and inline script to the
app's `script-src` ([Tauri CSP docs](https://v2.tauri.app/security/csp/);
`inject_script_hashes` in `tauri-codegen`). With a hash present, browsers
ignore `'unsafe-inline'`, so inline scripts in a `srcdoc` preview would not
run in the release app (dev builds load from `devUrl` and do not show this;
the e2e test `srcdoc under a release-like app CSP runs no inline script`
does).

So the native app frames `http://127.0.0.1:<port>/frame`. A small listener
in the app (`src-tauri/src/artifact_preview.rs`) binds a free loopback port
on first use; `get_artifact_frame_url` returns the URL:

- Every `GET /frame` gets one fixed bootstrap page
  (`artifact_preview_bootstrap.html`) with the same CSP as above plus
  `sandbox allow-scripts`, so the document has an opaque origin even without
  the frame attribute. Every other request gets 404. No artifact content ever
  reaches Rust, and the listener holds no secret.
- The bootstrap posts `splitkick-artifact-ready`. `SandboxedHtmlFrame` answers
  once, only to `event.source === its own frame`, with the page; the bootstrap
  accepts one message from `parent` and `document.write`s it. The document
  keeps the response's CSP and sandbox.
- The app CSP allows `http://127.0.0.1:*` in `frame-src` (`tauri.conf.json`).
  Loopback is a secure context, so a `tauri://` page may frame it.

### Tauri IPC

**Why loopback and not an app URI scheme (#82).** Until 2026-11-17 the frame
used `splitkick-artifact://`, a URI scheme the app registered. A native probe
showed that this was weaker than the docs said:

- WKWebView exposes `window.webkit.messageHandlers.ipc` to **every frame**,
  also a sandboxed one, and wry forwards the message with the frame's URL
  (`wry` `wkwebview/class/wry_web_view_delegate.rs`).
- Tauri treats every URI scheme that the app registers as a **local** origin
  (`is_local_url` in `tauri/src/webview/mod.rs`), with all the app's
  capabilities.
- So only the invoke key stopped a preview. The key is a random secret that
  only the main frame gets, and the frame cannot read the main frame. No
  exploit was known, but one secret was the only barrier.

A frame on `http://127.0.0.1:<port>` is a **remote** origin for Tauri. Tauri
rejects every command (app commands too) from a remote origin unless a
capability names it in `remote`, and no capability does. So the handler is
still visible in the frame, but a call gets "not allowed by ACL", with or
without the key.

**Native check, 2026-11-17, Splitkick 0.1.73, Tauri 2.12.3, wry 0.57.0,
macOS WKWebView.** The probe page `e2e/fixtures/tauri-ipc-probe.html`,
echoed by an agent as an html block, in a debug build with the bundled
frontend (`tauri build --debug --no-bundle --config
src-tauri/tauri.conf.dev.json`, page on `tauri://localhost`, release CSP):

| Check                                                             | In the frame                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `typeof __TAURI_INTERNALS__`, `__TAURI__`, `ipc`, `__TAURI_IPC__` | `"undefined"`                                                        |
| `Object.keys(webkit.messageHandlers)`                             | `[]`                                                                 |
| `typeof webkit.messageHandlers.ipc`                               | `"object"`: visible, but remote origin                               |
| `document.URL`                                                    | `"http://127.0.0.1:65144/frame"`                                     |
| `window.origin`, `document.domain`                                | `"null"`, `""`                                                       |
| `parent.document`, `top.__TAURI_INTERNALS__`                      | throw `SecurityError`                                                |
| `fetch('ipc://localhost/…')`, `fetch('http://ipc.localhost/…')`   | blocked (CSP)                                                        |
| `ipc.postMessage` with a wrong key                                | dropped: log `__TAURI_INVOKE_KEY__ expected … but received probe-82` |
| `postMessage` to the parent                                       | arrives with origin `null`; ignored                                  |

The same probe before the fix showed `document.URL` on the
`splitkick-artifact:` scheme, which Tauri treats as local. A message with the
correct key cannot be sent from the real frame, so
`artifact_preview::tests::tauri_rejects_every_command_from_the_frame_origin`
checks the decisive step with Tauri's mock runtime: a command with the
correct key from the frame URL is rejected, from `tauri://localhost` and from
a registered app scheme it runs. `no_capability_grants_remote_origins` fails
if a capability adds `remote`.

The [Isolation pattern](https://v2.tauri.app/concept/inter-process-communication/isolation/)
is about checking the app's own IPC calls and does not apply here.

### Residual risk

- **Self-navigation in a browser.** In Web Access the web UI sends no CSP, so
  a preview script can navigate _its own frame_ (`location.href = …`) and
  carry the data it holds in the URL. The frame holds only the artifact
  itself, never app data. Native app: the app's `frame-src` blocks web
  pages, but allows `http://127.0.0.1:*`, so a preview can navigate its own
  frame to a local port (the same reach as a browser tab). It still has no
  IPC there: every loopback URL is a remote origin.
- **Any local process can fetch the bootstrap page.** It is static and holds
  no secret or artifact content.
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
- `src-tauri/src/artifact_preview.rs` tests: the listener serves only
  `GET /frame` with the sandbox CSP; Tauri rejects every command from the
  frame origin even with the invoke key (#82); no capability has `remote`.
- `e2e/tests/artifact-sandbox.spec.ts`: real Chromium and WebKit, for the Web
  Access `srcdoc` frame and for the native bootstrap page on a loopback origin
  under a release-like app CSP, with the escape page and the IPC probe
  (`e2e/fixtures/tauri-ipc-probe.html`). The attack page
  `e2e/fixtures/sandbox-escape.html` tries fetch, WebSocket, images, external
  script, `sendBeacon`, `parent`/`top` DOM, `__TAURI_INTERNALS__`, storage,
  cookies, `window.open`, top navigation, `eval` and `postMessage`; all must
  fail, and no request may reach the network. Open the same file in the
  native app's file viewer to check WKWebView/WebView2: every line must say
  "blocked".
