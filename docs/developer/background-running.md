# Background running

Investigation of 2026-11-09 on mb14 (macOS 27.2, `main` at b8a64a36). Two questions:
what stays alive after a crash, and how schedules can run when Splitkick is not
open ([#119](https://github.com/azeitler/splitkick/issues/119)). Option A is built, see "Built" at the end.

## 1. "Running in Background" in the Dock

**Result (proven).** macOS 27 shows this state for an app whose main process is gone
while a process that macOS attributes to the app still lives. `lsappinfo` marks the
entry `(exited-with-subordinates)`. For Splitkick, these processes are the detached
agent runs. A crash is not necessary: a normal Quit with a detached run gives the
same state.

### Test

Bundle `app.splitkick.desktop.bgtest` (the debug binary), with its own data folder,
sealed `HOME` and the e2e stub in place of the Claude CLI. The stub is a `node`
process and started by the normal detached path. No model ran. The installed app was
not touched.

| Case | After the main process exits | When the last child is gone |
| --- | --- | --- |
| No run, SIGABRT | No `lsappinfo` entry after 5 s. No WebKit process is left. | n/a |
| Stub run (`node` only), SIGABRT | `(exited-with-subordinates)`, coalition holds only the `node` processes | Entry goes away |
| Stub run + real `--jean-mcp-stdio` and `--dialog` children, SIGABRT | Same, children stay under the live run | Kill the run: both MCP children exit within 5 s, entry goes away |
| Stub run, normal Quit | `(exited-with-subordinates)` | Entry goes away |
| Stub run, SIGABRT, then Dock menu **Stop Running in Background** | Dock menu is `Options`, `Open`, `Stop Running in Background` | **Every run process was killed**, entry goes away |
| Stub run, SIGABRT, then `open` (as a Dock click) | New main process, one Dock entry, the runs stay alive, the run record stays `running` with its pid | n/a |

Hypotheses:

- *A process started from the main executable keeps the bundle associated:* **wrong
  as stated.** A plain `node` child is enough. What counts is membership in the app's
  coalition. `lsappinfo` lists it: the detached runs stay in the coalition of the
  process that started them, even with ppid 1.
- *Surviving WebKit process:* no. WebKit processes end with the main process.
- *Leftover main process:* no. The main pid is gone in `ps`.
- *Stale LaunchServices entry:* no. The entry goes away when the last child ends.

Limits: the hover text itself was not read. The Dock menu item and the `lsappinfo`
state identify the same state. The test had no frontend (no dev server), so a relaunch
that reattaches the chat view to the run was not observed. That path is the existing
run recovery.

Other reports match this:
[styal #1037](https://github.com/incognitojam/styal/issues/1037),
[herdr-core #140](https://github.com/herdrdev/herdr-core/issues/140),
[Keyboard Maestro forum](https://forum.keyboardmaestro.com/t/macos-27-app-stuck-in-dock-permanently-running-in-background/51842).

### Wanted or leak?

| Process | Verdict | Evidence |
| --- | --- | --- |
| Detached `claude --print …` | Wanted. It finishes the turn and ends. | Design of `chat/detached.rs` |
| `--jean-mcp-stdio`, `--dialog` | Wanted while the run lives. Not a leak. | Test: exit on stdin EOF. On 2026-11-09, no MCP child with ppid 1 on mb14. |
| `--jean-pi-rpc-host`, `--jean-grok-acp-host`, `--jean-kimi-acp-host` | Wanted. They end with the turn and kill their child. | Code read only (`pi.rs`, `grok.rs`, `kimi.rs`). Not run. |
| One-shot helpers (session naming) | Short-lived. They also survive a crash until they end. | Test (ppid became 1) |

No leak and no small bug was found, so there is no code fix.

### What to do when it happens

- Click the Dock icon or choose **Open**. Splitkick starts again and the runs continue.
- Or wait. The entry goes away when the last run ends.
- **Do not choose "Stop Running in Background" if a run must finish.** It kills the
  runs. Choose it only to throw them away.

### Changes that are not built

These change how detached runs behave:

- Start runs outside the app's coalition (`responsibility_spawnattrs_setdisclaim`,
  private API, or a launchd job per run). The Dock state goes away, but "Stop" no
  longer reaches the runs, and privacy prompts then name the child. Untested.
- Show a short note at the next start: "N runs continued while Splitkick was closed."

## 2. Schedules when Splitkick is not open

### Facts from the code

- `fire_due` runs every 10 s in `BackgroundTaskManager`. A run more than 600 s late
  is "missed" and follows `schedule_missed_runs` (default `catch_up`: one run).
- Closing the last window quits the app unless a non-survivable session runs
  (`RunEvent::ExitRequested`, `src-tauri/src/lib.rs`).
- `SCHEDULES` is a per-process memory copy. The file write is atomic, but there is
  **no lock between processes**. Two processes on one data folder fire the same
  schedule twice and overwrite each other's changes.
- There is no single-instance guard.
- `run_server` and the desktop app use the same folder by default on macOS
  (`app.splitkick.desktop`, `DATA_DIR_NAME`) and the same MCP socket name.
- Agent runs reach Splitkick's MCP tools through the socket of the running instance.
  With no instance, those tools fail.
- PATH: `silent_command` runs `ensure_macos_path` (a login-shell probe) on first use,
  also in headless mode. launchd's small PATH is the same problem a Dock launch has
  and is already solved. HOME-based credentials work for a user agent. Keychain
  access under launchd was not tested.

### Sleep

Nothing below wakes a sleeping Mac by itself.

- App timers stop during sleep. The schedule fires after wake; if more than 10 minutes
  late it follows the missed-run preference. With `skip`, the 07:00 report is lost.
- launchd `StartCalendarInterval`: a job missed in sleep
  [runs after wake](https://developer.apple.com/library/mac/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html),
  and several missed times become one. A
  [forum report](https://developer.apple.com/forums/thread/815034) says on macOS 15/26
  it can start in a dark wake and stay suspended until a full wake.
- `pmset` [needs root](https://support.apple.com/en-euro/guide/mac-help/-mchl40376151/mac)
  and a wake [is not guaranteed](https://discussions.apple.com/thread/254622716).
  A user can run `sudo pmset repeat wake MTWRF 06:55:00` once. The app should not do it.
- Windows has [WakeToRun](https://learn.microsoft.com/en-us/windows/win32/TaskSchd/tasksettings-waketorun)
  and [StartWhenAvailable](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-startwhenavailable)
  (default delay 10 minutes). WakeToRun needs "wake timers" allowed in the power plan.

### Options

**A. Keep running after the last window closes, with a menu bar icon.**
- User sees: the window closes, the icon stays in the Dock and in the menu bar. The
  Quit command and the tray's Quit really quit.
- Work: small to medium. Extend `ExitRequested` with "enabled schedules exist or the
  setting is on"; destroy the window to free WebKit memory; `Reopen` already recreates
  it. Tray from #127. Start at login with `tauri-plugin-autostart` (not installed yet).
  The `install_schedule_notifier` code then has a job. Quit detail:
  `ExitRequested.code` is `None` for a user-caused exit and `Some` for `app.exit(n)`.
  The menu's Quit is `PredefinedMenuItem::quit`, so it must be tested whether it can be
  told apart from "last window closed". It may need a custom item that calls
  `app.exit(0)`.
- No Dock icon: `set_activation_policy` / `set_dock_visibility` exist on `AppHandle`
  (Tauri 2.12.3). `Reopen` needs the Dock, so the tray must then be the way back.
  Recommended later, not first.
- Risks: a forgotten process uses memory; a crash stops schedules until next start.
- macOS: as above. Windows: closing with no tray leaves an invisible process, so the
  tray is required there.
- 07:00 report: **yes**, if the app runs (needs start at login). On a sleeping Mac: at wake.

**B. OS wake with a one-shot `Splitkick --jean-run-due-schedules`.**
- User sees: nothing until the run appears; a login item in System Settings.
- Work: large. It needs:
  - A data-folder lock held by the app. The one-shot exits at once if the app is open.
    An app that starts during a one-shot waits and then reloads schedules.
  - A launchd job. [`SMAppService`](https://developer.apple.com/documentation/servicemanagement/smappservice)
    plists sit in the signed bundle and are fixed, so "next due time" cannot be
    written there. Use a fixed `StartInterval` (for example 5 min) that exits when
    nothing is due. It needs user approval. A plain file in `~/Library/LaunchAgents`
    can hold the time but is less clean.
  - The one-shot must stay alive until its runs end, as MCP socket and queue drain. If
    it exits early, launchd
    [kills the job's process group](https://keith.github.io/xcode-man-pages/launchd.plist.5.html),
    and `spawn_detached_claude` does not create a new one. `AbandonProcessGroup` avoids
    this, but MCP tools then have no socket.
- Risks: most moving parts; run results and notifications need the app's recovery;
  a second writer on all session files. In effect it is a short-lived headless server.
- Windows: Task Scheduler with `InteractiveToken`, `StartWhenAvailable`, `WakeToRun`.
  Not tested whether the child runs survive the task's end.
- 07:00 report: **yes**, also after a window close; needs login. Asleep: at wake (Windows can wake).

**C. Headless server (`src-server` or `--headless`) as a login service.**
- User sees: a service, and the desktop app as its client.
- Shared data folder: technically yes (same default path). **Unsafe with the desktop
  app open** (no lock, double fire, same socket). A separate folder works but has other
  projects and sessions, so the user's schedules are not there.
- Work: large if the desktop must become a client of a local server. Small only for
  people who use the server instead of the app. No native notifier in headless mode.
- macOS and Windows: launchd / service wrapper needed on both.
- 07:00 report: **only if the schedule lives on the server**. Not for desktop users.

**D. An always-on instance through Remote Connections (#94).**
- User sees: the schedule is made on that instance; `remote_tool` can already reach
  `create_schedule`.
- Work: none in code. A short guide and a machine that is on.
- Risks: the repo and CLI login must exist there; no always-on machine in the current setup.
- macOS and Windows: same. A server is not affected by the laptop's sleep.
- 07:00 report: **yes, the only option that also works with the laptop asleep**.

**E. Copy only.**
- "Runs while Splitkick is running. Missed runs run once at the next start."
- Work: trivial (`src/components/chat/ScheduleDialog.tsx:235-236`). No risk.
- 07:00 report: **no**, but the app stops promising what it does not do.

**F. Prevent sleep while a schedule is near** (`caffeinate` / power assertion).
- Only for a running app, and it does not help with a closed lid on battery. Drains the
  battery. Not recommended.

### Recommendation

**Build A together with #127, and ship E now.** E corrects a false sentence today. A
gives the tray its reason to exist and #127 gives A the required way back and way to
quit. Scope:

1. Tray from #127, always when "Show in menu bar" is on.
2. Keep running after the last window closes while enabled schedules exist. Keep the
   Dock icon in the first version.
3. "Open at login" setting, offered when the first repeating schedule is made.
4. A real Quit in the menu and the tray.

Do not build B or C unless real use shows the process cost is a problem. Document D
and the optional `pmset` line for those who need a run on a sleeping machine.

Sources not linked above:
[Tauri system tray](https://v2.tauri.app/learn/system-tray/),
[Tauri `app.rs`](https://docs.rs/tauri/latest/src/tauri/app.rs.html),
[LogonType](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-logontype-principaltype-element).

## Built (option A with #127)

- `RunEvent::ExitRequested` (`exit_action` in `src-tauri/src/lib.rs`): when the last
  window closes (`code` is `None`) and an enabled schedule exists, the app stays
  running with no window. Cmd+Q does not pass through `ExitRequested`, so it still
  quits. On Windows the app stays only if the tray icon is on. Linux is unchanged.
- Tray: `src-tauri/src/tray.rs`, macOS and Windows. A Rust loop reads the shared
  5-minute usage cache every 5 minutes, because the frontend query does not run with
  no window. It adds no requests. "Refresh now" skips the cache.
  `useTraySync` rebuilds at once when the account list changes.
- Linux has no tray (`tray_stub.rs`): the binding aborts if the system library is missing.
- `show_in_menu_bar` preference, and "Open at login" (`tauri-plugin-autostart`, state
  in the OS, off by default) under Settings > General > Scheduled prompts.
- `limits` from the usage endpoint and RFC 3339 `resets_at` values are parsed. Before,
  every date-form reset time was lost. The dock and Preferences part of #126 is still open.
