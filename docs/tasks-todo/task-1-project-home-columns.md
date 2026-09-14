# Project home — mirror the Home view in the project view

Source: https://github.com/azeitler/jean/issues/23

## Goal

Give a selected project the same answer Home gives for everything: the sessions
touched last, what happened since, and the open GitHub issues — scoped to that
project, beside the worktree list.

## Decisions

- **One set of sections, not two.** `RecentSessionsSection` and
  `RecentActivitySection` take an optional `projectId`. Home passes nothing.
  Only the issue list is new, because Home spans every project and an issue list
  belongs to one repository.
- **The activity filter runs in Rust, not in the browser.** `ActivityEvent`
  already carried `project_id`, but the 30-row cap is global: a busy project
  would push a quiet one out of its own feed. `list_recent_activity` now takes
  `project_id` and filters before it truncates.
- **Three equal columns, like Home.** The same container-query grid, in the
  reading order Home uses: what you did (recent sessions, recent activity),
  what you can act on (the worktrees), what is waiting (the open issues). The
  columns split later than Home's (`@4xl` / `@7xl` rather than `@2xl` / `@4xl`)
  because a worktree row carries branch, git badges, diff stats and PR state,
  and needs more width than a session row.
- **All three columns carry a heading.** The worktree column gets "Worktrees"
  from the same `HomeSection` frame, but only while the overview columns are
  up. On its own the worktree list is the whole canvas, and the project name in
  the header already names it.
- **The session filter appears sooner in a project column.** Home waits for six
  rows; a project column is already narrowed to one project, so two rows are
  enough. An empty project shows the heading and a line of text rather than
  vanishing, which Home does because an empty Home means an empty app.
- **The overview hides during a search.** A search narrows the worktree list;
  unchanged columns beside it would read as noise.
- **A project with no GitHub remote shows nothing**, not an error
  (coollabsio/jean#354).

## Work items

### Rust

- [x] `jean-core/src/activity/mod.rs` — `list_recent_activity(app, limit,
  project_id)`, with the order/filter/cap split into `select_recent` so the
      order of those three steps is testable without an `AppHandle`.
- [x] `jean-core/src/http_server/dispatch.rs` — read `projectId` / `project_id`.
- [x] `jean-core/src/lib.rs` — `project_rail_hidden` on `UIState`.
- [x] Tests: project filter, cap order, newest-first, `UIState` round trip, and
      a dispatch test that proves web access reaches the filter.

### Frontend

- [x] `src/services/activity.ts` — `useRecentActivity({ limit, enabled,
  projectId })`, with `projectId` in the query key so Home and the rail do
      not share a cache entry.
- [x] `src/components/home/HomeSection.tsx` — lifted out of
      `RecentSessionsSection`, so the dashboard does not import a section from a
      sibling section.
- [x] `RecentSessionsSection` / `RecentActivitySection` — optional `projectId`;
      the row drops the project name when every row is one project.
- [x] `src/components/dashboard/ProjectOpenIssuesSection.tsx` — open issues,
      newest first, capped at 20 with "Show all N", filter field, preview modal,
      and the no-remote / no-login guard.
- [x] `src/components/dashboard/ProjectHomeColumns.tsx` —
      `ProjectOverviewColumn` and `ProjectIssuesColumn`, placed separately so
      the worktree column sits between them in the DOM. CSS `order` would have
      split the reading order from the visual one.
- [x] `src/components/dashboard/ProjectCanvasView.tsx` — container-query grid
      around the worktree column and the overview columns, and a header toggle.
- [x] `projectRailHidden` in the projects store (guarded against no-op writes),
      persisted through `useUIStatePersistence`.

### Verification

- [x] `bun run check:all`.
- [ ] Manual pass in the running app. No Jean run environment was up, so this
      is covered by tests only. The dispatch test stands in for the web-access
      check.

## Not covered

- Linear issues in the rail. That belongs with coollabsio/jean#708.
- A Starred section. Home has one; the rail does not, because a star is global
  by design and the issue asked for three sections.
