# Webview Recovery and the Memory Log

Issue #97: under memory pressure macOS suspends Splitkick or kills its WebKit
content process. The backend and its sessions are fine, but the window can stay
empty. Code: `src-tauri/src/webview_watchdog.rs`, `src-tauri/src/memory_log.rs`,
`jean-core/src/memory_report.rs`, `src/lib/webview-liveness.ts`,
`src/hooks/useWebviewRecovery.ts`.

## Recovery

| Trigger                              | What happens                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content process terminated (macOS)   | `Builder::on_web_content_process_terminate` → our handler reloads from a worker thread (queued on the event loop), one retry. Replaces Tauri's default, which gives up when the window list is borrowed. |
| Wake / resume / focus / every minute | The backend emits `webview-liveness-ping` to each visible window; the page answers `webview_liveness_pong`. Two misses in a row → recover.                                                               |
| Page answers but `#root` is empty    | Reload (not during the 45 s start grace).                                                                                                                                                                |

- **Wake and resume detection:** Tauri has no system-wake event on macOS. A
  15 s tick that arrives more than 45 s late means the process (or machine)
  did not run in between: that covers sleep, an OOM pause and SIGSTOP.
- **A hung content process needs ending, not reloading.** `reload()` goes to the
  same process, so a stopped one stays stuck (seen in testing). On macOS the
  watchdog sends SIGKILL to the webview's own content process and lets the
  termination handler reload in a new one.
- **Never while it answers.** Any answer clears the misses. New windows and
  reloaded pages get a 45 s grace. After 3 reloads without an answer the
  watchdog stops until the page answers again.
- **After the reload** the page takes its note once with `take_webview_recovery`
  (shared promise `takeWebviewRecovery()`), shows the toast, and skips the
  startup `kill_all_terminals` so run environments survive. UI state
  persistence restores project, worktree and session. Runs live in the backend
  and continue; `e2e/local/tests/reload.spec.ts` proves it.

## Finding the WebKit content process

WebKit runs it as an XPC service: its parent is launchd, so a process-tree walk
does not find it. Each `WKWebView` reports its process through the
`_webProcessIdentifier` SPI (read on the main thread via `with_webview`,
guarded by `respondsToSelector:`). Memory comes from `proc_pid_rusage`
(`ri_phys_footprint`), which works for processes of the same user.

Windows and Linux log only the main process (`GetProcessMemoryInfo`,
`/proc/<pid>/status`); `webContent=n/a`.

## Log line

```
Memory: main=120 MB webContent=136 MB[pid 98945 main] children=0 cachedSessions=2 nativeHistory=0 runLogTailers=0 cliRuns=0 terminals=0 eventListeners=0 wsClients=0 wsReplayEvents=0 wsTerminalReplay=0 KB frontend=main(queries=65 domNodes=209)
```

Warning level above 4 GB for the main or a content process.

## Testing by hand

Use an isolated build (`bunx tauri build --debug --no-bundle --config
src-tauri/tauri.conf.dev.json`, run with `SPLITKICK_DATA_DIR=<repo>/tmp/...`).
Take the content pid from the memory line, check it with `ps`, then:

- `kill -9 <content pid>` → "content process … terminated", "is back".
- `kill -STOP <app pid>`, wait > 45 s, `kill -CONT` → "resumed after a Ns
  pause", no reload.
- `kill -STOP <content pid>` → two missed pings, "ending hung content process",
  "is back".

Never signal the installed app's processes.
