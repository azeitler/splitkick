# iOS app that caches the app code — evaluation (issue #72)

Date: 2026-10-31. Status: evaluation only, no app code changed.
Issue: [#72](https://github.com/azeitler/splitkick/issues/72). Related:
[#63](https://github.com/azeitler/splitkick/issues/63),
[#64](https://github.com/azeitler/splitkick/issues/64).

## Summary

The trigger for this issue: the Home Screen app **reloads often** (Andreas,
2026-10-31). Decided: the iPhone uses Tailscale HTTPS (`tailscale serve`); push
comes later.

- **No option stops iOS from ending the page.** iOS ends the web content process
  of a background Home Screen app, and a native `WKWebView` app has the same kind
  of process. A native app can reload less often (normal app life cycle) and can
  detect the end, but this is not proven. See
  [Why the Home Screen app reloads](#why-the-home-screen-app-reloads).
- **So the goal is a reload that the user does not see:** the shell comes from
  the device in about 0.1 s, the phone opens on _its own_ last view, and login
  and connections stay. Today a reload costs 0.6–4.7 s of network on mobile, and
  the phone opens on the view that the _desktop_ saved last.
- **Recommendation:** (1) measure how often and why the app reloads today,
  (2) make the reload cheap in the frontend (service worker + per-device view
  restore). This work is also needed inside a native app, so no work is lost.
  (3) In parallel (decided): a Tauri v2 iOS shell spike on the device, to
  measure if native reloads less.
- The goal is the App Store (decided). Guideline 2.5.2 then requires a
  **bundled** frontend, and a bundled frontend fights the release cadence: 14
  Splitkick releases from 2026-10-18 to 2026-10-29. Version skew is the main
  design problem; see [Decisions](#decisions).

## What the fork has today

| Item                   | State                                                                                                                                                                                                                                       | Effect on this work                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web app manifest       | `public/manifest.webmanifest` (`display: standalone`), Apple meta tags in `index.html`. Name is still "Jean".                                                                                                                               | Home Screen install works. Rename to Splitkick is a small fix.                                                                                               |
| Service worker         | None. No `navigator.storage.persist()` call.                                                                                                                                                                                                | Phase 1 adds it.                                                                                                                                             |
| Asset caching          | `jean-core/src/http_server/server.rs`: hashed assets `public, max-age=31536000, immutable`; `index.html` and `jean-build.json` `no-store`. Brotli/gzip on.                                                                                  | Warm loads are already fast. But every start needs the network for `index.html`, so an unreachable server shows a Safari error page, not the app.            |
| Version check          | `webBuildId` in `jean-build.json` and `/api/init`. `src/lib/web-client-version.ts` shows a "Reload" toast when the page is older than the server. `src/lib/remote-version.ts` compares versions for native remotes and warns, but connects. | The service worker can use the same check. A bundled native app gets only a warning, so it can call commands that the server does not know (or the reverse). |
| Bundled UI + remote    | The desktop app already runs its bundled UI against a remote server (`remote-<id>` windows, `docs/developer/connection-windows.md`). CORS allows `tauri://localhost` (`cors_origins()` in `server.rs`).                                     | Helps a Tauri iOS shell: transport, auth, recovery and CORS exist. Blocks: the `main` window always drives a **local** backend; iOS has none.                |
| Token storage          | `localStorage['jean-http-token']` (browser), connection list in `localStorage` (`src/lib/remote-connections.ts`). Token also travels as `?token=` on `/ws` and `/api/*`.                                                                    | PWA: token is in web storage. Native: can move it to the Keychain.                                                                                           |
| SSO proxy              | `SSO_PROXY_ERROR` (issue #15): a native WebView cannot pass Cloudflare Access cookies on the WebSocket.                                                                                                                                     | A native shell must use Tailscale, not the Cloudflare Access URL. The PWA works with both.                                                                   |
| Notifications          | Toasts and native desktop notifications (`docs/developer/notifications.md`). No Web Push, no APNs.                                                                                                                                          | Push is new server work for every option.                                                                                                                    |
| Reconnect after resume | Fixes for #64 (`b56aa0eb`): reconnect when the auth check hangs after a phone resume.                                                                                                                                                       | Needed for every option. A cached shell does not remove the auth → WebSocket → `/api/init` round trips.                                                      |

## Baseline measurement

Method: `vite build` into `tmp/dist`, a Node static server with the same cache
headers and gzip as `server.rs`, Playwright Chromium on a Mac with CDP network
throttling. No backend, so the app boots to its "Loading Splitkick…" / auth
screen. "Warm" is a second load in the same browser (HTTP cache full,
`index.html` fetched again). Script: `tmp/measure/measure.mjs` (not committed).

Build: 732 files, 26 MB on disk (700 JS chunks, most are Shiki languages that
load on demand). Boot path: `index-*.js` 376 KB gzip, `terminal-*.js` 271 KB
gzip and a few more, preloaded from `index.html`.

| Link (latency, down)     | Cold: requests | Cold: on wire | Cold: to first render | Warm: on wire | Warm: to first render |
| ------------------------ | -------------: | ------------: | --------------------: | ------------: | --------------------: |
| No throttling            |             35 |       1163 KB |                238 ms |          3 KB |                 60 ms |
| Good 4G (80 ms, 20 Mbps) |             35 |       1163 KB |                585 ms |          3 KB |                128 ms |
| Slow 4G (150 ms, 4 Mbps) |             34 |       1161 KB |               2014 ms |          3 KB |                207 ms |
| 3G (300 ms, 1.6 Mbps)    |            12+ |       863 KB+ |               4717 ms |         19 KB |                361 ms |

Notes:

- The main view loads more chunks after login (for example `ChatWindow-*.js`,
  192 KB gzip). The real cold cost is higher than the table.
- On the 3G row the counter stopped before all requests finished (`+`).
- An iPhone parses JavaScript slower than an M-series Mac. That cost stays with
  every option, also a native app.
- **The gain of a cache is the difference between "cold" and "warm":** 0.5–4.4 s
  on a mobile link. The HTTP cache already gives this when iOS keeps it. A
  service worker or a native bundle makes it reliable and adds offline start.
- WebKit cannot throttle through CDP, so the throttled numbers are Chromium only.
  Not measured on a real iPhone over Tailscale.

## Spike: service worker app-shell cache

`tmp/dist-sw/sw.js` (not committed), about 40 lines:

- `install`: fetch `index.html`, cache it and every `/assets/*` that it
  references.
- Navigation: network first with a 3 s timeout, cached `index.html` as fallback.
- `/assets/*`: cache first (names are content hashes). `/api/*` and `/ws`: not
  touched.
- `index.html` also calls `navigator.storage.persist()`.

Test (`tmp/measure/sw-spike.mjs`): load once, reload so that the worker controls
the page, **stop the server**, open a new page.

| Engine              | Worker controls page | `persist()` | Boots with server down    | Time   |
| ------------------- | -------------------- | ----------- | ------------------------- | ------ |
| Chromium            | yes                  | false       | yes, "Loading Splitkick…" | 99 ms  |
| WebKit (Playwright) | yes                  | false       | yes, "Loading Splitkick…" | 157 ms |

Result: the riskiest technical assumption for phase 1 holds. The Vite build
(hashed chunks, `no-store` index) works with a small hand-written worker, also
in WebKit. `persist()` is `false` because the test runs in a normal tab;
WebKit grants it by heuristics, for example for a Home Screen web app.
Not proven: eviction and `persist()` on a real iPhone (iOS 26).

A Tauri iOS spike was not cheap here: no iOS Rust targets, no CocoaPods, and
Xcode 16.4 has only the iOS 18.5 SDK. Uploads to App Store Connect need Xcode 26
and the iOS 26 SDK since 2026-04-28.

## What iOS allows a Home Screen web app (WebKit policy)

- **Quota:** a Home Screen web app has the same origin quota as Safari: up to
  60 % of disk per origin, 80 % overall. No prompt since Safari 17.
  ([WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/))
- **Eviction:** whole origin, least recently used first, when the quota is full or
  the device is low on storage, or after a time without use under ITP. An origin
  with an open page or in persistent mode can be excluded. Cache API and service
  worker registrations are in scope. (same source)
- **7-day rule:** script-writable storage (IndexedDB, localStorage, service worker
  registrations) is deleted after 7 days without use. A Home Screen web app has
  its own day counter, so each start resets the timer.
  ([WebKit: Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/))
- **`persist()`:** granted by heuristics, "like whether the website is opened as a
  Home Screen Web App". (Storage Policy post)
- **Secure context:** service workers and `persist()` need HTTPS. A plain
  `http://` Tailscale URL gets neither. `tailscale serve` gives HTTPS with a real
  certificate for the MagicDNS name
  ([Tailscale Serve](https://tailscale.com/kb/1312/serve)).
- **Push:** Web Push for Home Screen web apps since iOS 16.4, permission only
  after a user tap. Declarative Web Push since iOS 18.4
  ([WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)).
- **Process kill:** iOS ends a background web app at any time. The next start is
  a full page load. No option keeps the JavaScript heap; the gain is only how fast
  and how reliably the shell comes back.

Conclusion: for an app used daily, **storage eviction is not the main problem**.
The day counter resets on each start, and `persist()` is likely granted for a
Home Screen app. The pain is the reload (next section).

## Why the Home Screen app reloads

Reload sources in the code (browser mode, `grep location.reload src`):

| Source                                                                | When                                    | Seen by the user as a "random" reload?            |
| --------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| iOS ends the web content process of the background app                | After a switch to another app, any time | **Yes, the likely main cause**                    |
| `WsTransport` wake handler (`visibilitychange`, `pageshow`, `online`) | Resume                                  | No: it reconnects the socket, no reload (#64 fix) |
| `recoverRemoteAfterDrop()` in `transport.ts`                          | Socket drop                             | No: native remote windows only                    |
| "Reload" toast in `web-client-version.ts`                             | New server build                        | No: user taps it                                  |
| Error boundaries, token submit, connection switch, palette "Reload"   | Errors, user actions                    | Only after a crash                                |

Facts and limits:

- Reloads of Home Screen web apps after an app switch are a known, old
  complaint, and Apple does not document the rule
  ([2015 report](https://zacster.blogspot.com/2015/04/broken-web-apps-launched-from-ios-home.html),
  [WHATWG thread](https://lists.w3.org/Archives/Public/public-whatwg-archive/2015Jun/0008.html)).
- Native `WKWebView` apps see the same symptom
  ([Home Assistant iOS #2719](https://github.com/home-assistant/ios/issues/2719)).
  A native app can do more about it: `webViewWebContentProcessDidTerminate`
  tells it that the page ended, and it can reload from a local copy at once.
  Whether it reloads _less often_ is not measured.
- What a reload loses today:
  - `sessionStorage` reload state (`src/lib/web-reload-state.ts`) is kept for
    60 s only, and iOS drops `sessionStorage` when it ends the process.
  - The phone then restores the **host's shared UI state**. That state is the
    last view of whichever client saved last, often the desktop
    (`mobile-gap-analysis.md`, gap 2). This is likely the "lost state".
  - The token and the connection list are in `localStorage` and stay.
  - The JS bundle: from the HTTP cache if iOS kept it, else 1.16 MB again.

Measurement gap: there is no data on how often the app reloads, and why. Phase 1
step 1 adds it.

## Options

### (a) PWA: service worker + persistent storage

- Served by Splitkick itself, same origin as the API. A Vite step writes
  `sw.js` with the precache list from the build manifest, or a hand-written
  worker reads the list from `index.html` (the spike).
- Shell: network first with a short timeout, cache fallback. Assets: cache first.
  API and `/ws`: never cached.
- Version skew: the worker and the server come from the same build. A new build
  installs a new worker; the existing `webBuildId` toast ("Reload") covers the
  short gap. On "Reload", call `registration.update()` and `skipWaiting()`.
- Cloudflare Access: a navigation with an expired Access session gets a redirect.
  The worker returns it as is and does not cache it, so the browser goes to the
  Access login. To test on the device.

### (b1) Thin native shell, Tauri v2 iOS

- Same stack as the desktop app. Tauri iOS uses `WKWebView`, page origin
  `tauri://localhost`, which the server's CORS list already allows.
- Needs a **separate small crate** (for example `src-ios/`), not `src-tauri`:
  `src-tauri` pulls in PTY, the embedded browser, `jean-core` and the local
  server, none of which run on iOS.
- Frontend work: a "remote only" mode. Today `isNativeApp()` plus no remote
  connection means "local backend" (`isLocalBackend()`), and the `main` window
  drives the local core. iOS needs the connection list as the first screen.
- Toolchain: full Xcode 26, Rust targets `aarch64-apple-ios` and
  `aarch64-apple-ios-sim`, CocoaPods
  ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).
- Keychain for the token: needs a small native plugin (Swift) or a community
  plugin. Not in Tauri core.

### (b2) Thin native shell, Capacitor

- Mature for iOS, good plugins (Keychain, push). But a second JS toolchain and
  native project next to Tauri.
- Its `server.url` option (load the remote UI) is "not intended for use in
  production" ([Capacitor discussion #5075](https://github.com/ionic-team/capacitor/discussions/5075)).
  A bundled UI has the skew problem below.

### (b3) Thin native shell, plain Swift `WKWebView`

- Smallest dependency set: one Xcode project, about 200 lines of Swift. Keychain
  and APNs are direct Apple APIs.
- `WKURLSchemeHandler` can serve a cached copy of the server's `dist` from the
  app container. That is the "caches the app code on the device" model without a
  bundle in the binary.
- Second code base in a language the fork does not use yet.

### (c) Other

- **Do nothing on the client, fix the start path:** keep `index.html` `no-store`
  but make auth, WebSocket and `/api/init` start in parallel and show cached UI
  state at once. Helps every option; does not fix the offline error page.
- **Native shell that caches the server's frontend** (hybrid of a and b): the app
  downloads `dist` from the server when `webBuildId` changes and serves it
  locally. No skew, offline start, Keychain. But it runs code that was not in the
  reviewed binary → conflicts with App Review 2.5.2 (see below). Fine for
  TestFlight internal testing.
- **Remote desktop / screen sharing apps:** no, not usable on a phone for chat.

## Comparison

| Criterion            | (a) PWA + service worker                                               | (b) Native shell, bundled frontend                                                | (c) Native shell, caches server frontend                     |
| -------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Load-time gain       | Cold → warm on every start (0.5–4.4 s on mobile links, measured above) | Same, plus no first download                                                      | Same as (a)                                                  |
| Offline start        | Shell boots, shows "Loading" / reconnect                               | Shell boots                                                                       | Shell boots                                                  |
| Persistence          | Web storage; 7-day counter resets on use; `persist()` by heuristic     | App container, not part of Safari ITP eviction; token in Keychain                 | Same as (b)                                                  |
| Login / token        | `localStorage` (as today)                                              | Keychain                                                                          | Keychain                                                     |
| Connection list      | One server per Home Screen app (origin)                                | Many servers in one app                                                           | Many servers                                                 |
| Push                 | Web Push (VAPID) from the server; iOS 16.4+                            | APNs: auth key + server sends to APNs                                             | APNs                                                         |
| Cloudflare Access    | Works                                                                  | Does not work (issue #15); Tailscale only                                         | Tailscale only                                               |
| Version skew         | None (same build); existing reload toast                               | **High**: 14 releases in 12 days; needs a protocol version and a "too old" block  | None (downloads the server's build)                          |
| Distribution         | None. HTTPS URL + "Add to Home Screen"                                 | TestFlight internal (no review) or App Store (4.2 risk)                           | TestFlight internal only (2.5.2)                             |
| Apple account        | Not needed                                                             | Paid program (Andreas has an Apple Distribution identity, so it exists)           | Paid program                                                 |
| Effort (first value) | Small: worker + build step + HTTPS setup + docs, about 1–2 days        | Medium–large: new crate, remote-only mode, Keychain, signing, CI, about 1–2 weeks | Large: (b) plus download/verify/serve cache, about 2–3 weeks |
| Upkeep               | Low; part of the web build                                             | High: Xcode/SDK yearly bumps, 90-day TestFlight builds, a new build per release   | Medium: shell rarely changes; Xcode/SDK bumps, 90-day builds |

### App Store and TestFlight rules

- **2.5.2:** apps may not "download, install, or execute code which introduces or
  changes features or functionality of the app". A shell that runs the server's
  latest frontend does exactly that.
- **4.2:** an app must be more than "a repackaged website". A thin shell around
  Web Access is a likely 4.2 rejection.
- **4.2.7 (remote desktop):** host must be user-owned and on the local network,
  and "thin clients for cloud-based apps are not appropriate for the App Store".
  ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/))
- **TestFlight internal testing:** up to 100 testers from the team, no Beta App
  Review, each build expires after 90 days
  ([TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)).
  External testing needs Beta App Review, so the rules above apply.
- **SDK:** uploads must use Xcode 26 and the iOS 26 SDK since 2026-04-28
  ([Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)).
- **Signing:** this Mac has an "Apple Distribution" identity but no "Apple
  Development" identity. Xcode creates the development certificate on first
  device run.

Result: a public App Store app is not a realistic goal. A native app is for
Andreas and the team through TestFlight internal testing.

## Recommendation and phased plan

**Phase 0 — HTTPS on the Tailscale path (setup, no code).**
Run Web Access behind `tailscale serve` so that the iPhone opens
`https://<mac>.<tailnet>.ts.net/`. Re-add the Home Screen app from that URL. Add
the steps to the user docs. The Cloudflare Tunnel URL is HTTPS already.

**Phase 1 — smallest useful step: measure, then make the reload cheap.**
All of it is frontend work that a native shell reuses.

_Status 2026-11-10: steps 1–3 are built (reload log, device view, service
worker; see `mobile-layout.md`). Step 4, the check on an iPhone, is open._

1. **Reload log.** On `pagehide`, write a timestamp to `localStorage`. On start,
   record the navigation type and the time since the last hide. A start shortly
   after a hide without a user reload is an iOS process end. Show the count in
   Settings → Web Access, or log it. Use the app for a few days. This gives the
   baseline to compare a native spike against.
2. **Per-device view restore.** Save the phone's own view (project, worktree,
   open session modal, active session) in `localStorage`, not the 60 s
   `sessionStorage`, and prefer it over the host's shared UI state on a phone.
   This also fixes `mobile-gap-analysis.md` gap 2.
3. **Service worker** (spike above): `public/sw.js` or a Vite step that writes
   the precache list. Shell network first with a 3 s timeout; assets cache
   first; never `/api/*`, `/ws`, `/preview/*`, `jean-build.json`. Register in
   browser mode and secure context only; serve `sw.js` with `no-store`; call
   `navigator.storage.persist()`; on a new `webBuildId` update the worker, then
   the existing "Reload" toast. Rename the manifest to Splitkick.
4. Test on an iPhone (iOS 26) over `https://<mac>.<tailnet>.ts.net/`: reload
   count, time to shell, the view after a reload, airplane-mode start.

Success: after an iOS process end, the phone shows the same session it showed
before, in under 0.5 s for the shell, and shows the app (not a Safari error)
when the Mac is not reachable.

**Phase 2 — native shell spike (in parallel with phase 1, decided).**
Tauri v2 iOS shell in its own crate (for example `src-ios/`):

1. Toolchain: Xcode 26, iOS Rust targets, CocoaPods, an Apple Development
   certificate (Xcode makes it).
2. Spike: `tauri://localhost` page → `wss://<mac>.<tailnet>.ts.net/ws` on a real
   iPhone, with the reload log from phase 1. Compare reloads per day with the
   PWA. Handle `webViewWebContentProcessDidTerminate` with an instant local
   reload.
3. If it reloads clearly less: bundled frontend (App Store, guideline 2.5.2),
   protocol version range and "update the app" screen, "remote only" start
   screen with the connection list, token in the Keychain, the native features
   for guideline 4.2. TestFlight internal first, then App Store review.

**Phase 3 — push notifications.** Web Push (VAPID) for the PWA, or APNs for the
native app. For the App Store, APNs is also a strong native feature (4.2), so
this phase can move into phase 2.

## Decisions

Made on 2026-10-31:

- iPhone URL: **Tailscale HTTPS** (`tailscale serve`).
- Push notifications: **later** (phase 3).
- The PWA exists and reloads often; that is the reason for this issue.
- A reload is **a complete reload**: the whole page starts again, so all
  in-memory state is lost. This agrees with an iOS process end, not with a
  reload from the app code.
- **Phase order: phase 1 and phase 2 in parallel.**
- **Distribution: the App Store is the goal.** The app is not a plain shell; it
  has native features, or features that look native.

### What the App Store goal changes in the plan

- **Guideline 2.5.2 blocks option (c).** An App Store build cannot download and
  run the server's frontend. The frontend must be **bundled** in the binary.
  Phase 2 step 3 changes from "cache the server's frontend" to "bundle the
  frontend".
- **Version skew becomes the main design problem.** With 14 releases in 12 days
  and an App Review for each app update, the app is often older than the
  server. The plan needs:
  - a protocol version in `/api/init` and in the bundled frontend, with a
    supported range (not only the app version, as `remote-version.ts` does now);
  - a clear "update the app" screen when the server is out of the range, in
    place of today's warning-and-connect;
  - a rule for the server to keep old command names and arguments working for a
    time, because the app cannot follow each server release.
- **Guideline 4.2 risk stays.** Reviewers judge features that use iOS, not a web
  UI that looks native. Native candidates: APNs push, Keychain login with Face
  ID, share sheet, Home Screen widget or Live Activity for a running session,
  native connection list. Push moves closer for this reason.
- TestFlight internal testing stays the first channel; it needs no review and
  shows early whether a bundled build can follow the server.

Open:

1. **Version skew policy:** how many server releases must an App Store build
   support? This sets how long the server keeps old commands.
2. **Native features for 4.2:** which of the candidates above are in the first
   App Store version? APNs push is the strongest; it was "later" before.
