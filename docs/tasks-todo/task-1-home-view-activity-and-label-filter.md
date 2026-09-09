# Home view, activity log, and shared label filter

Source: https://github.com/azeitler/jean/issues/7

## Goal

1. Make the welcome screen a real **Home** view, reachable from a pinned row at
   the top of the sidebar. Keep `WelcomeProjectGrid` and add recent sessions and
   a recent activity feed.
2. Add a **shared label filter control** used by Home, the sidebar, and the
   project canvas.

## Decisions

- **Activity data comes from a real append-only event log.** No derivation from
  current session state. Jean writes one JSONL record at the moment each event
  happens. This gives true timestamps and true history.
- Home stays `WelcomeProjectGrid`'s slot: no project selected and no worktree
  active. The existing `active_project_id` persistence restores it. No new
  persisted UI-state field.
- One label matcher in `src/lib/label-filter.ts`. All three surfaces use it.

## Work items

### Rust — activity log

- [x] `jean-core/src/activity/mod.rs` — `ActivityKind`, `ActivityEvent`,
      `record()`, `list_recent()`, `clear()`. JSONL in the app data dir, flavor
      aware, trimmed to `MAX_EVENTS`. Best effort: a write failure never fails
      the caller.
- [x] `jean-core/src/lib.rs` — declare `mod activity;`.
- [x] `jean-core/src/http_server/dispatch.rs` — `list_recent_activity`,
      `clear_activity_log`.
- [x] Record sites:
  - `chat/run_log.rs` — `complete()`, `cancel()`, `mark_crashed()`.
  - `projects/commands.rs` — `commit_changes`, `create_commit_with_ai`,
    `open_pull_request`, `create_pr_with_ai_content`, `run_review_with_ai`.
  - `background_tasks/mod.rs` — PR merged or closed, on state change.
- [x] Emit `activity:appended` so Home refreshes live.
- [x] Rust tests for append, trim, order, and corrupt-line tolerance.

### Frontend — Home view

- [x] `src/types/activity.ts`, `src/services/activity.ts` (`useRecentActivity`).
- [x] `src/components/home/HomeView.tsx` — projects grid (reuses
      `WelcomeProjectGrid`), Recent sessions, Recent activity.
- [x] `src/components/home/RecentSessionsSection.tsx` — uses `useAllSessions()`,
      `computeSessionCardData`, and `SessionListRow`. Opens with
      `navigateToSession()`.
- [x] `src/components/home/RecentActivitySection.tsx` — `formatRelativeTime`.
- [x] `src/components/layout/MainWindowContent.tsx` — render `HomeView`.
- [x] `src/components/projects/ProjectsSidebar.tsx` — pinned Home row above
      `ProjectTree`, icon only when `isNarrow`.

### Frontend — shared label filter

- [x] `src/lib/label-filter.ts` — `matchesLabelFilter`, `collectLabelOptions`.
- [x] `src/components/labels/LabelFilterChips.tsx` — shared control.
- [x] Home: filter recent sessions by label.
- [x] Sidebar: `session-filter-utils.ts` gains label matching; `WorktreeList`
      shows the control.
- [x] Canvas: `canvas-worktree-filters.ts` uses the shared matcher.

### Verification

- [x] `bun run check:all`
- [x] Manual pass in the running app.

## Result

Done. `bun run check:all` passes (2420 frontend tests, 1132 Rust tests).

**Activity source.** `jean-core/src/activity/mod.rs` is an append-only JSONL log
in the app data directory, flavor aware, trimmed to 500 records. Jean writes a
record at the moment of the event, so the feed carries true timestamps.

Record sites:

- `chat/run_log.rs` - `complete`, `cancel`, `mark_crashed`, `crash`.
- `projects/commands.rs` - `commit_changes`, `create_commit_with_ai`,
  `open_pull_request`, `create_pr_with_ai_content`, `run_review_with_ai`.
- `background_tasks/mod.rs` - `emit_pr_status` logs a merge or a close through
  `record_once`, keyed on `pr:<url>:<state>`. GitHub does not tell Jean when a
  pull request is merged, so the poller sees it. The key makes the first
  sighting win, and it survives a restart because the check reads the log.

`clear_activity_log` was written and then removed: nothing called it.

**Not covered.** "Background tasks completed" from the issue has no matching
concept. `BackgroundTaskManager` is a status poller, not a user task queue.

**Verification.** Jean was built and started headless on port 8977.
`list_recent_activity` answered over the WebSocket, while an unknown command
returned `Unknown command`. The GUI window did not appear on the captured
display, so the Home view itself is covered by component tests, not by eye.
