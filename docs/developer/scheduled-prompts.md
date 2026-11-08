# Scheduled prompts (#38)

One mechanism for every prompt that runs later: Claude's `ScheduleWakeup`,
the composer's *Send later…* / *Repeat…*, and the Splitkick MCP
`create_schedule`. All live in `schedules.json` (app data) and fire from Rust,
so no window has to be open.

## Files

- `jean-core/src/chat/schedules.rs`: model, store, fire path, agent schedules,
  end-of-run hook. In-memory copy behind one mutex; writes are temp + rename.
- `jean-core/src/background_tasks/mod.rs`: calls `fire_due()` every 10 s.
- `jean-core/src/chat/commands.rs`: Tauri-style commands; the queue drain
  calls `scheduled_run_finished()` after a queued message with `scheduleId`.
- `jean-core/src/jean_mcp_core.rs`: MCP `create_schedule`, `list_schedules`,
  `cancel_schedule`.
- `src-tauri/src/desktop_commands.rs`: `install_schedule_notifier()`.
- Frontend: `src/services/schedules.ts`, `src/lib/schedule-compose.ts`,
  `src/components/chat/ScheduleDialog.tsx`, `useComposerSchedule.tsx`,
  `ScheduledBanner.tsx`, `src/components/schedules/ScheduledView.tsx`,
  `src/components/projects/SidebarScheduledRow.tsx`.

## Model (`Schedule`, snake_case, Pattern A)

| Field | Meaning |
| --- | --- |
| `origin` | `agent` (ScheduleWakeup, MCP) or `user` |
| `target` | `session` (into `session_id`) or `new_session` (a new session in `worktree_id` per run) |
| `session_id` | Where the schedule was made; for `new_session` only where the chat banner shows it |
| `template` | Queued-message fields overlaid on the session's saved settings at fire time |
| `enabled` | `false` = paused |
| `recurrence` | `{cron, tz}`; absent = one-off, removed after it ran |
| `last_*` | Last run time, outcome (`queued`, `skipped`, `failed`), error, session |

Every new field has `#[serde(default)]`: older files still load.

## Fire path

1. `take_due()` takes enabled schedules with `fire_at_unix <= now`. A repeating
   one moves to its next time after now; a missed one (> 10 min late) runs
   once or is skipped (`schedule_missed_runs`).
2. `fire()`: for `new_session`, `create_session` first. Then the prompt goes
   into the session's `queued_messages` and `trigger_backend_queue_drain`
   sends it. The queue handles busy sessions and send races.
3. A fire error (session or worktree gone, archived) pauses the schedule and
   keeps it, also a one-off, with `last_error`.
4. After the run, the drain calls `scheduled_run_finished()`: a send error is
   recorded (the schedule stays on, Edit can fix it), then the notifier.

## Modes

- Composer: the template carries the toolbar mode. Yolo needs the confirm in
  `ScheduleDialog`.
- MCP: `capped_mode()` = the lower of the calling session's and the target's
  mode (plan < build < yolo). An agent never schedules a run with more rights
  than it has. A session keeps one agent schedule (last wins).

## Notifications

With a window, also a hidden one, the frontend's usual notification path
covers the run (closing the last window quits the app, or hides the windows
while sessions run). Only when no webview window exists while the app runs
does the desktop notifier show a native notification; a click opens the
session. That keeps it from notifying twice. The
headless server installs no notifier: a connected client notifies.

## Commands

`list_schedules`, `create_schedule`, `update_schedule`, `set_schedule_enabled`,
`run_schedule_now`, `delete_schedule` — jean-core commands, so only a
`dispatch.rs` arm. Each mutation emits `cache:invalidate` with `schedules`.
