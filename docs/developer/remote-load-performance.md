# Remote load performance

How fast a client that talks to a remote instance (a remote window, Web Access
in a browser or on a phone) gets from start to a usable sidebar, opens a
project, opens a session, and switches between them. Measured on 2026-11-26.

## Method

A repeatable rig with generated data. It never reads the real data dir.

| Script                             | What it does                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/perf/seed-remote-load.ts` | Writes a data dir in `/tmp`: 80 projects (real git repos), 319 worktrees, 400 sessions, 8,757 runs. 8 sessions have 300–400 runs. Run logs are hard links to the neutral fixtures in `jean-core/src/chat/testdata`. `--remote-url` points `origin` at a given URL. |
| `scripts/perf/ws-bench.ts`         | Times single commands over the WebSocket: server time and response bytes. Scenarios `commands`, `cached-status`, `contention`.                                                                                                                                     |
| `scripts/perf/web-trace.ts`        | Opens Web Access in headless Chromium (Playwright), records every WebSocket command and response per user action, and can throttle the link through CDP (`--throttle slow` = 400 kbit/s, 400 ms latency). `--timeline` prints the order of sends and events.       |

```sh
cargo build --manifest-path src-server/Cargo.toml   # or --release
bunx vite build                                     # the server serves dist/
bun scripts/perf/seed-remote-load.ts /tmp/sk-perf
SPLITKICK_DATA_DIR=/tmp/sk-perf/data RUST_MIN_STACK=33554432 \
  src-server/target/debug/splitkick-server --host 127.0.0.1 --port 47811 --token t
bun scripts/perf/ws-bench.ts 47811 t commands
bun scripts/perf/web-trace.ts 47811 t --throttle slow --steps startup,project,session,switch
# afterwards: stop the server, rm -rf /tmp/sk-perf, git checkout -- dist/.gitkeep
```

Byte counts are the JSON text of WebSocket responses. WebSocket frames are not
compressed, so this is what crosses the link. `/api/init` is HTTP and is
compressed (Brotli).

## Server time per command

Release build, local SSD, warm cache, three runs.

| Command                             | Time     | Bytes      |
| ----------------------------------- | -------- | ---------- |
| `list_projects`                     | 5–8 ms   | 15.5 KB    |
| `list_worktrees` (1 project)        | 1 ms     | 1 KB       |
| `bootstrap_project` (1 project)     | 1–13 ms  | 16 KB      |
| `bootstrap_project` ×80 in parallel | 57 ms    | 583 KB     |
| `list_all_sessions`                 | 21–46 ms | 503 KB     |
| `get_session`, 25-run window        | 6–7 ms   | 82 KB      |
| `get_session`, no limit (335 runs)  | 54–62 ms | 1,122 KB   |
| `/api/init` (HTTP)                  | 45–48 ms | 723 KB raw |

The server is fast. On a remote link the cost is the number of bytes and of
round trips, not server CPU. (A debug build is 5–10× slower; the
`[LoadMessages] slow load … in 1393 ms` from the field comes from larger real
logs and a cold disk.)

## Action → commands → time → bytes (Web Access)

"Time" is until the last command response of the step. Before = `main` at
1.6.4; after = the four commits below.

| Action                    | Link | Before: commands / bytes / time  | After: commands / bytes / time |
| ------------------------- | ---- | -------------------------------- | ------------------------------ |
| Startup (sidebar open)    | fast | 241–322 / 1.7–2.3 MB / 2.4–4.4 s | 161 / 692 KB / 2.4 s           |
| Startup (sidebar open)    | slow | 332 / 2.33 MB / 106 s            | 170 / 703 KB / 58 s            |
| Open another project      | fast | 99 / 608 KB / 1.2 s              | 20 / 8.8 KB / 1.3 s            |
| Open another project      | slow | 98 / 608 KB / 18.8 s             | 21 / 8.9 KB / 1.4 s            |
| Back to the first project | slow | 181 / 1.21 MB / 36.7 s           | 16 / 4.5 KB / 1.3 s            |
| Open a session            | fast | 119 / 1.81 MB / –                | 39 / 208 KB / –                |
| Open a session            | slow | 121 / 1.73 MB / 51.2 s           | 31 / 118 KB / 3.9 s            |
| Switch project (repeat)   | fast | 97–108 / 608 KB                  | 16–22 / 4–28 KB                |
| Switch project (repeat)   | slow | –                                | 16–22 / 4–28 KB / 1.3–1.6 s    |

On the fast link, every command of a session open answers in under 250 ms
before and after; the step's last answer is a CLI version check (12 s, see
"Other leads"), so no step time is given. The sidebar became visible after
22 s on the slow link both before and after: that is the static bundle (see
cost 5).

## Top costs

### 1. One status event made every client reload every project — fixed

Each `git:status-update` makes every client call
`update_worktree_cached_status`. Dispatch answered every call with a global
`cache:invalidate ["projects"]`, also when the server had already saved the
values, and 250 ms later every client refetched `bootstrap_project` for every
project in the sidebar: 80 calls, 587 KB. A project click starts an immediate
status poll, so every click paid this; startup paid it two or three times
(239 calls, 1.74 MB). This is lead 1 (#161: 7–8 bootstraps per click with 8
projects).

- **Fix** (`15ca4e0ce`): the command reports the changed project. No change →
  no event; a change → `worktrees:changed` for that one project. Live values
  still reach every client through `git:status-update`.
- **Gain:** project click 99 commands / 608 KB → 20 / 8.8 KB. **Risk:** low;
  the cached fields are only a fallback before the live status arrives.
- **Test:** `cached_status_tests` in `jean-core/src/projects/commands.rs`.

### 2. The sidebar bootstrapped every project at startup — fixed

`ProjectTreeItem` mounts `useWorktrees` per project, and each called
`bootstrap_project` (worktrees plus the session lists with message counts of
all its worktrees): 80 calls, 583 KB, for collapsed rows that show no
sessions.

- **Fix** (`e9cacb7db`): a project that is neither selected nor expanded loads
  `list_worktrees` alone. Opening it later loads its sessions per worktree, in
  parallel.
- **Gain:** startup 1.18 MB → 692 KB (`bootstrap_project` 83 → 4,
  `list_worktrees` 0 → 79, 80 KB). **Risk:** low; the canvas already falls back
  to `get_sessions` per worktree.
- **Test:** `src/services/projects.worktrees-load.test.tsx` counts the calls.
- **Next step (proposal):** one `list_projects` answer that carries the
  worktrees of all projects would replace the 79 calls by none. Medium size,
  needs a protocol change.

### 3. `list_all_sessions` (503 KB) on every session open — partly fixed

The unread bell refetched the list of all sessions of all projects on each
`session-opened` window event, once or twice per open. The server already
sends a worktree-scoped invalidation for the same change.

- **Fix** (`36b5ebc80`): the event names the sessions; the hook stamps
  `last_opened_at` in the cache and refetches only for unknown sessions.
- **Gain:** session open 1.81 MB → 208 KB; 51 s → 3.9 s on the slow link.
- **Test:** `src/components/unread/useRefreshSessionsOnOpen.test.tsx`.
- **Still open (proposal):** the one call at startup is 503 KB, 32 s on the
  slow link, and it is the largest item left in the startup traffic. Each
  `Session` in it carries all metadata (review results, pending approvals,
  answered questions). A slim summary (id, name, worktree, `last_opened_at`,
  last run status and end, `started_by_session_id`) would be about a fifth.
  The History tab and Home read more fields, so this needs a second command
  and a review of every reader. Medium size.

### 4. Full message history after each turn and on reconnect — fixed

`hydrateCompletedSessionFromBackend` (after each turn) and the resume path in
`App.tsx` (each running session on reconnect) called `get_session` with no
limit: 1.12 MB for a 335-run session, against 82 KB for the 25-run window of
`useSession`. This is lead 2.

- **Fix** (`eb251406d`): both use `fetchSessionWindow` (the `useSession`
  window, merged with the cache so older loaded pages stay).
- **Gain:** per refresh 1.12 MB → 82 KB, server 330–490 ms → 32–50 ms (debug).
- **Test:** `fetchSessionWindow` in `src/services/chat.test.ts`; the
  `useStreamingEvents` tests assert `limit: 25`.
- **Still open (proposal):** a worktree-scoped `cache:invalidate` refetches
  every mounted session detail (`applyScopedSessionsInvalidation`), because the
  event does not name the session. Opening one session therefore loads it twice
  (2 × 82 KB). Adding `sessionIds` to the event would halve that. Small, but it
  touches every emitter of the event.

### 5. First visit: 824 KB of assets before any data — proposal

The first load downloads 824 KB Brotli (`index` 409 KB, `terminal` 266 KB,
`markdown` 106 KB, CSS 33 KB). At 400 kbit/s that is about 16 s, which is most
of the 22 s until the sidebar shows. Assets are cached as `immutable`, so
this repeats only after a release. The terminal chunk is `modulepreload`ed in
`index.html` although the first screen has no terminal.

- **Proposal:** load the terminal chunk on demand. Expected gain about 5 s on
  the slow link per new release. Small to medium (find the static import).
  Build change, not data loading, so not done here.

## Other leads

- **`/api/init` preload (lead 6).** 723 KB raw, compressed over HTTP. 681 KB
  of it is `activeSessions`: the open session of every worktree of the
  focused project (4 here), 50 runs each, although the first screen shows one
  session, and `useSession` uses a 25-run window. Proposal: send only the
  active worktree's session, with the 25-run window. Small; the seeded data
  compresses unrealistically well (8 KB), so the gain on real data is unknown.
- **Git fetch storms and 60 s timeouts (lead 3).** On the server, commands run
  on the blocking pool: during 162 commands that each hang in `git fetch`
  (origin pointed at a port that never answers), `list_projects` stayed at
  8–18 ms. There is no shared lock. But one `get_worktree_changes` can run two
  30 s fetches in a row and took 64.6 s, longer than the client's 60 s
  timeout. The `[transport] Command '…' timed out after 60s` message comes only
  from the native read timeout: in the desktop app, `dispatch_core_command`
  (`src-tauri/src/lib.rs`) awaits every command on the Tauri async workers,
  with no `spawn_blocking`. A few commands that block in git or process calls
  can then starve `list_projects`. Proposal: run native dispatch through the
  same `spawn_blocking` wrapper as `websocket.rs` (keep `terminal_write`
  ordered), and give the fetch in `get_branch_status` one shared deadline.
  Not measured: this rig has no native window.
- **Startup session backup (lead 4).** With a local target folder the first
  backup copied 273 MB; during it `list_all_sessions` took 250 ms instead of
  88 ms, other commands did not change. It runs on its own blocking thread and
  takes no lock the commands use. Low priority.
- **`gh` badge flood (lead 5, #51).** Not measured: the seeded repos have no
  GitHub remote. The lesson from #51 holds for this work too: a per-project
  call in a sidebar row costs N round trips on a remote link.
- **CLI version checks.** `get_available_codex_versions` took 11.4 s (network)
  about 10 s after start. Not on a load path, and on the server it runs on its
  own thread.
- **WebSocket compression.** Frames are sent raw. permessage-deflate would cut
  JSON traffic several times, but needs a transport change. Proposal only.

## Not measured

- A real remote host over a real slow network (the rig throttles the browser
  link on one machine).
- The native desktop app's own command path (see lead 3).
- Real data compressibility of `/api/init`.
