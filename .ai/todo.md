# Sidebar sticky stack (#45)

- [x] Mockup (`docs/mockups/sidebar-sticky/`); chosen: full stack, stuck section headers stack and jump on click, hairline.
- [x] Starred moved into the projects scroller; section wrappers `display: contents`; headers via `SidebarStickySectionHeader`.
- [x] Folder (top level), project and worktree rows sticky; offsets as CSS variables in `App.css`; 24 px headers below 600 px height.
- [x] `useSidebarStickyStack` marks stuck rows + hairline; `keepStuckRowInSlot` on collapse; `scroll-margin-top` for reveal.
- [x] Tests (`sidebar-sticky.test.tsx`), typecheck, eslint `src`, 407 test files pass; checked in the dev build over web access (WebKit, 420/700 px).

Result: done. `check:all` lint step fails only on old scratch files in `tmp/` (not part of this change).

# Sidebar layout (#55)

- [x] Tabs at the top; Projects tab: Home + Starred pinned, then Folders, Projects, Archived (scrolls). Footer removed.
- [x] Folders/Projects headers use `SidebarSectionRow` (collapsible, "+ New", bulk toggle); collapsed state persisted (`folders_section_collapsed`, `projects_section_collapsed`).
- [x] Archived row opens `ArchivedView` in the main area (`archivedViewOpen`, not persisted); phones keep the dialog.
- [x] Reveal re-opens the section that holds the target.

## Review

- `check:all` parts green (typecheck, eslint, branding, rustfmt, clippy 1.99.1, 3320 Vitest, Rust tests).
- Live (dev build, demo repos): new order, Archived view, sections stay open after restart. Not verified live: drag and drop, collapse click (AX press could not find the toggle), phone layout.

# Desktop: Mac-style unified toolbar (spec 2026-10-14-unified-toolbar-design.md)

- [x] Shell: `toolbar-slots.tsx` (portal slots, newest owner wins), `WindowToolbar`, `SidebarHeader`/`SidebarFooter`, `UpdatesButton`, 52pt height, traffic lights centred (`trafficLightPosition`).
- [x] Home, project canvas, session modal fill the toolbar; phone keeps its headers (`useHasWindowToolbar`).
- [x] Narrow toolbar: labels (`data-toolbar-label`) hide < 1000px; title keeps 16rem.
- [x] Tests: slots, toolbar, footer, Home, wiring; e2e `window-toolbar.spec.ts`; migrated 4 source tests + 2 e2e specs.

## Review

- `bun run check:all` green (393 files); e2e 45 passed, 2 skipped.
- Live (dev build, demo repo): Home, canvas, session, sidebar hidden, zen captured. Not verified live: narrow container-query steps (window min width 1000; sidebar drag failed in automation), Windows, Linux.

# macOS: menu bar, dock badge + menu, notification clicks

- [x] Menu built in `app_menu.rs`; `kb:`/`cmd:` ids; accelerators follow keybindings (`set_menu_accelerators`); File/Go/Session/Help; custom Minimize (Cmd+M stays Magic Menu).
- [x] Key-originated menu duplicates dropped (`isMenuEventFromPassedKey`), except actions that must work from terminals.
- [x] Dock badge = unread count; dock menu via `applicationDockMenu:` added to tao's delegate (`dock.rs`, `useDockSync`).
- [x] Notification click opens session (plugin 2.6 `on_action`; pulled Tauri 2.10 → 2.12); one dock bounce for "needs input".
- [x] Zen → Ctrl+Cmd+Z on macOS native; client-stored keybindings now migrated too.

## Review

- `bun run check:all` green (388 files); Rust 34 tests.
- Live (dev build): menu dump shows user shortcuts incl. ⌃⌘Z; menu click and Cmd+B toggle sidebar once; Ctrl+Cmd+Z toggles zen; Cmd+M no minimize; dock menu shows New Worktree.
- Not verified live: badge number and session entries (empty dev profile), notification click (needs a background run).

# Remote hosts with many projects: server stalls, errors read as "empty"

- [x] WS dispatch: every command on the blocking pool (tokio workers stay free for heartbeats).
- [x] `fetch_worktrees_status`: one process-wide pool of 8 git workers, de-duplicated queue; one locked update per worktree (`update_projects_data`).
- [x] `update_worktree_cached_status`: skip the projects.json rewrite when nothing changed.
- [x] CLI status/auth queries rethrow; `useInstalledBackends.isUnknown`; banner, welcome screen, sidebar and magic-prompt defaults ignore unknown checks.
- [x] Projects load failure: Retry instead of Welcome / "No projects found".

## Review

- mb16 reproduction (before): trivial `load_preferences` 2–50 s during a startup burst, some never answered.
- Local synthetic host (66 repos, 330 worktrees, `scratch/wsstress.ts`): before p95 1.52 s / max 2.95 s, after p95 0.01 s / max 0.01 s. All 330 statuses persisted.
- `bun run check:all` green. mb16 retest needs the new build installed there.

# Mobile: no title bar, lower tab bar, Home switch, no CLI alerts

- [x] Phone title bar only in zen; content offset by `--safe-area-top`; project name moved into the session header.
- [x] Tab bar: `px-5`, `pb-[max(0.5rem, safe-bottom − 0.75rem)]` → 22pt/20pt on an iPhone, concentric with the corners.
- [x] `useCliVersionCheck` skipped on phones; effect bails out explicitly (shared query cache with Preferences).
- [x] Home: Continue first, then Sessions / Projects switch (`mobileHomeSegment`, not persisted); Recent excludes Unread and Continue.

## Review

- 375/375 unit files; e2e 40 passed, 2 skipped (with `--workers=2`: the machine ran at load 235, default workers timed out unrelated specs). Mutation-checked the CLI effect gate.
- Live run with iPhone insets injected: 0 title bars, Continue above the switch, pill 22px from the bottom and 20px from the sides, project name in the session header. The host now offers a real JeanZ update (z.15), so yesterday's feed fix is live.

# Mobile: Usage tab, Settings from the Home gear

- [x] Tab `settings` → `usage`: `MobileUsageTab` is `UsagePane` only; `UsageTabIcon` = chart glyph in the usage ring.
- [x] Gear top right on Home (`MobileTabPage` `action` slot) pushes `MobileSettingsPage` (updates, panes, About); update dot on the gear.
- [x] Settings page renders in the shell, not a portal, so the Preferences dialog lands above it (e2e checks the topmost element).

## Review

- 374/374 unit files; e2e 39 passed, 2 skipped; lint, types clean. Live run 5/5, ring 79% on the Usage tab.

# Mobile: Settings tab, title bar is only the title

- [x] Fourth tab `settings` (TS type, persistence already string-based in Rust).
- [x] `SettingsUsageIcon`: gear inside a usage ring (`usePeakUsage`, severity colour), update dot.
- [x] `MobileSettingsTab`: updates, usage (`UsagePane`), Preferences panes (`getMobileNavigationGroups`, moved to `preferences-navigation.ts` to keep the dialog lazy), About.
- [x] Phone `TitleBar`: early return with the title only; zen exit stays.
- [x] Unread bell → Home Unread section + Home badge; `useRefreshSessionsOnOpen` extracted so History/Unread stay fresh.
- [x] File browser toggle → phone session header; header buttons 44px.

## Review

- 374/374 unit test files; e2e 38 passed, 2 skipped; lint and types clean.
- Live run on the real backend (390×844): 7/7. Ring showed Claude Weekly 78% in amber; Home badge 26 = 26 Unread rows.

# Mobile navigation: three tabs, projects as modals, sessions push

Decisions: History = recently opened sessions (`last_opened_at`); Home = Continue row + projects; search = floating round button bottom right; drawer retired in one step.

- [x] Persist `mobile_active_tab` (TS `UIState`, Rust `UIState` + round-trip test, snapshot, restore, save subscription).
- [x] `src/components/mobile/`: `MobileTabShell`, floating `MobileTabBar` + detached search button, `MobileHomeTab` / `MobileStarredTab` / `MobileHistoryTab`, `MobileProjectLayer`.
- [x] Stack derived from `selectedProjectId` / `sessionChatModalOpen`, no new store. Layer entry `modal` (project opened) vs `push` (session opened from a tab: click-through, canvas invisible, back returns to the tab).
- [x] `SessionChatModal`: slide-in from the right, back chevron on phones. `ProjectCanvasView`: `mobilePresentation` + `onDismiss`.
- [x] Retire `MobileLeftSidebar`, the sidebar swipe and the phone title-bar sidebar button; dock hidden at the tab root only.
- [x] Tests: 41 unit tests in `src/components/mobile/`, tab persistence, routing, dock visibility; `e2e/tests/mobile-navigation.spec.ts` (first phone-viewport e2e).

## Review

- 371/373 unit test files pass (2 pre-existing model-picker failures); e2e 36 passed, 2 skipped (existing fixme); lint, types, jean-core clippy and fmt clean.
- Screenshots at 390×844 caught one regression the tests missed: the project layer at `z-30` hid the corner dock. Restacked to `z-[2]` under the dock `z-10`, with a guard test.
- Mutation-checked the two load-bearing guards (project-switch blip, dock stacking): both tests fail without the fix.

# Chat markdown: relative paths in the canvas session modal (#19)

- [x] `LocalPathRootContext` in `chat-links.ts`; `resolveLocalPath` / `openChatLink` take a root path, store as fallback.
- [x] `SessionChatModal` provides its `worktreePath`; `MarkdownImage` and `MarkdownLink` read it.
- [x] Tests: 2 new tests (store path `null`) fail without the context; 2680 frontend tests pass.

# Follow-ups from the Starred investigation

- [x] `create_session` emits a `sessions` cache invalidation (agents over MCP included); `create_base_session` too, since it restores sessions. Source guard test fails without the emit.
- [x] e2e harness: `get_run_scripts: []` (null crashed every sidebar render) and `list_all_sessions: { entries: [] }` (real shape).
- [x] e2e suite: 30 pass, 2 fixme (was 6 pass, 26 fail). Root causes: the web client maps mod to Control, a worktree click now opens the session modal, New session goes through a picker, terminal tabs are not buttons.
- [ ] Product: per-session MCP toggles are unreachable in the chat UI (desktop dropdown removed upstream in ec7d9e8f; the compact Settings trigger stays hidden). The two MCP e2e tests are fixme until it is back.
- [ ] Not done: rare unhandled error attributed to `WorktreeItem.test.tsx` under full-suite load (1 of 4 runs).

# Starred: a star on a session missing from the all-sessions cache never shows

- [x] Reproduce: in the e2e harness, starring a session the cache does not hold leaves the Starred section empty.
- [x] Fix: the Star menu item refreshes `['all-sessions']` after it stars a session.
- [x] Proof: before/after e2e run (0 vs 1 refetch, section empty vs shown); regression test fails on the old code.

# Chat links and HTML paths open in the embedded browser

- [x] `chat-links.ts`: classify web / local page / local file; route click, Cmd-click and fallbacks. `resolveLocalPath` moved here from `markdown.tsx`.
- [x] `MarkdownLink` with ↗ system-browser button; `data-chat-link` skipped by `useExternalLinkInterceptor`.
- [x] `remarkLocalHtmlLinks`: HTML paths in text and inline code become links; `urlTransform` keeps `file:` hrefs.
- [x] Jean MCP `open_in_browser` (rate-limited) → `browser:open-url` → `openUrlInWorktreeBrowser`.
- [x] Tests: 25 new frontend, 4 new Rust; 2662 frontend and 1151 jean-core tests pass; clippy 1.98 clean.

## Review

- Dropped the planned custom URL scheme: a WKWebView `loadRequest` probe loaded a `file://` page with CSS, JS, subfolder and `../` assets.
- No context-menu items: the ↗ button and Cmd-click cover the system browser.
- Not checked in the live app: no Jean run-environment tool in this session.

# Chat markdown: render image embeds reliably and safely

- [x] `escapeMarkdownImageDestinations` wraps image paths with spaces in `<...>` (skips code).
- [x] `markdown.tsx`: image-only `urlTransform` (data:image, file:, drive paths), shared `resolveLocalPath`, `MarkdownImage` with `read_file_base64` fallback and placeholder.
- [x] `convertProjectFileSrc` routes app-data paths to `/api/files` in web mode.
- [x] Tests: 7 of 8 new renderer tests fail on the old code; 28 markdown tests pass.

## Review

- Raw-HTML sanitizing (`rehype-sanitize`) stays out of scope (user chose option 1).
- Not checked in the live app: no Jean run-environment tool in this session.

# Sidebar rows: pin glyph and label last

- [x] `PinGlyph` beside `StarGlyph` on workspace session rows and Starred rows; none in the Pinned section.
- [x] Label moved after the activity timestamp on workspace session rows.
- [x] Tests: 4 new behaviour tests fail on the old code; 2561 frontend tests pass.

# Sidebar Pinned/Starred rows: indent and no tree jump

Issues: azeitler/jean#17, azeitler/jean#18.

- [x] Nest sidebar pinned rows in the workspace session-list container (`ml-9`/`ml-6`, guide line).
- [x] Add `revealInSidebar` to `navigateToSession`; pass `false` from the sidebar Pinned and Starred rows.
- [x] Tests: nesting at both widths, parity with `WorktreeItem`, the no-reveal path, both callers.

## Review

- The jump came from the #9 reveal inside `navigateToSession`, which the
  shortcut rows inherited. The option skips the expansion and the scroll but
  keeps `selectWorktree`, so no stale workspace stays highlighted.
- Canvas, Home, palette, unread bell and Back/Forward keep the reveal.
- 7 of the new tests fail on the pre-fix code; 2555 frontend tests pass.

# Session sorting (#8) and starred sessions (#12)

Issues: azeitler/jean#8, azeitler/jean#12.

## #8 Per-project session sort

- [x] Pure sort helper in `worktree-sort-utils.ts` (mode + direction, numeric title collation).
- [x] `sessionSortMode` / `sessionSortDirection` on `ProjectCanvasSettings`: store setter, TS ui-state, Rust struct, persistence, Rust + TS tests.
- [x] Sort control on the project row next to "Filter sessions".
- [x] Apply inside each workspace's status groups in `WorktreeItem`.
- [x] Changelog, commit.

## #12 Starred sessions

- [x] `starred_sessions` + `starred_sessions_collapsed` in Rust `UIState`, TS ui-state, persistence, tests.
- [x] `starSession` / `unstarSession` / `setStarredCollapsed` on the projects store with guards.
- [x] Resolver over `useAllSessions()` (star order, archived hidden, never pruned).
- [x] Extract the Pinned parent row and row list; Pinned keeps its behaviour.
- [x] Sidebar Starred section under the Home row; Home view Starred section.
- [x] Star / Unstar in the shared session menu; star glyph on sidebar rows.
- [x] Invalidate `['all-sessions']` on rename and unarchive.
- [x] Changelog, commit.

## Decisions (open questions in the issues)

- #8: sort within each workspace's status groups; workspace order and pin order unchanged; per project only.
- #12: star order (newest star last); context menu only; per machine (UI state); archived stars hidden, not pruned.

## Review

- #8: the sort runs after `groupCardsByStatus`, because that function applies
  its own in-group order; sorting its input first would be overwritten.
- #12: stars resolve against `useAllSessions()`, the cache Home, the palette
  and the unread bell already share, so the feature adds no backend query.
- #12: `SidebarSectionRow` and `SessionShortcutRows` were extracted from
  `PinnedSessionsSection`, as #13 asked; its 15 existing tests guard the move.
- Not done: a live UI check. No Jean run environment tool was available.

---

# Pin sessions to a project root

Issue: coollabsio/jean#698. Bug found on the way: azeitler/jean#5.

- [x] Add `PinnedSessionEntry` and `pinned_sessions` to the Rust `ProjectCanvasSettings`.
- [x] Mirror the field in the TypeScript `ProjectCanvasSettingsState` and the projects store.
- [x] Add `pinSessionToProject` / `unpinSessionFromProject` with no-op state guards.
- [x] Save and restore the pins in `useUIStatePersistence`.
- [x] Add "Pin to Project" / "Unpin from Project" to the shared `SessionContextMenuItems`.
- [x] Add a shared resolve helper and a `PinnedSessionsSection` component.
- [x] Render the section on the project canvas and in the sidebar worktree list.
- [x] Add store, helper, component, menu, persistence, and Rust serde tests.

## Review

- The pins reuse `project_canvas_settings`, the slot that already holds the
  worktree sort mode and the pinned labels. No new Tauri command, no dispatch
  entry, and no new field on the session record.
- A pin stores `{sessionId, worktreeId}`. Both surfaces already know the
  worktree at pin time, and the worktree lookup doubles as the staleness check.
- Stale pins are dropped at render time, never pruned from storage. A prune
  effect would run while the session queries are still loading and would delete
  valid pins on a slow start. Unarchiving a session brings its row straight back.
- Both surfaces open a pinned session through `navigateToSession`, the helper
  the command palette and the unread bell already use.
- Pinned rows stay out of the canvas keyboard navigation. `flatCards` indexes
  worktree sections and also drives the 1-9 shortcuts, the drag-reorder ids and
  the auto-select effects. Session rows there would need a discriminated union
  in every one of those.
- Both surfaces read sessions that are already loaded, so the feature adds no
  data fetch.
- Gates: typecheck, eslint, `cargo fmt --check`, clippy, 1115 Rust tests and
  2343 frontend tests pass. Six unrelated component tests time out under full
  parallel load and pass in isolation; each run fails a different set.

## How to test

- Right-click a session in the sidebar, choose "Pin to Project". The row shows
  under the project row and at the top of the project canvas.
- Click a pinned row on either surface. The session opens on its own tab.
- Right-click a pinned session tab in the chat modal. The item reads "Unpin from
  Project". Unpin, and the row leaves both surfaces.
- Pin a session of workspace B while you look at workspace A. The row names B
  and opens B.
- Change the canvas filter tab: the section stays. Search: it hides.
- Press 1-9 and the arrow keys on the canvas: selection walks workspaces only.
- Restart Jean: the pins stay. `ui-state.json` holds
  `project_canvas_settings.<projectId>.pinned_sessions`.
- Archive a pinned session: the row leaves on the next refresh. Unarchive it and
  the row returns.

# Sidebar tree: keep workspace expansion + show collapsed count badges

Issue: azeitler/jean#4 (upstream: coollabsio/jean#714, coollabsio/jean#715)

- [x] Add `expanded_worktree_ids` to the Rust `UIState` struct and the TypeScript `UIState` interface.
- [x] Save, restore, and subscribe to `expandedWorktreeIds` in `useUIStatePersistence`.
- [x] Add a shared `CollapsedCountBadge` and use it on collapsed folder, project, and workspace rows.
- [x] Add tests for the badge, the project row, and the persistence hook.

## Review

- `expandedWorktreeIds` was the only tree expansion set that never reached
  `UIState`. The fix follows the existing project/folder pattern.
- Worktrees are not loaded when the restore runs, so worktree ids are restored
  as-is. Ids of removed workspaces stay in the Set but no row reads them.
- The field is optional in TypeScript and uses `#[serde(default)]` in Rust, so
  saves written before this change still load.
- One badge component serves all three rows, so they cannot drift apart.
- Gates: typecheck, eslint on the changed paths, `cargo fmt --check`,
  `cargo check` on jean-core, and 2227 frontend tests pass.

## How to test

- Expand a workspace row, quit Jean, start it again - the row stays expanded.
- Collapse a workspace, project, or folder row - a badge shows the hidden count.
- Expand the row again - the badge disappears.

# Chat message timestamps and a "Last active" session badge

- [x] Confirm no clock timestamp existed in the thread, and that `02:25` is the turn runtime.
- [x] Add `formatMessageTimestamp` and `formatLastActive` to `src/lib/relative-time.ts`.
- [x] Extract `MessageMetaLine` and use it in `MessageItem` and `CompactMessageList`.
- [x] Add the timestamp to user message bubbles.
- [x] Add the "Last active" badge to `ChatWindow`.
- [x] Add unit and integration tests, and keep the runtime regression guards.
- [x] Search GitHub issues and discussions for related reports.
- [x] Record review results and test steps.

## Review

- The turn runtime is unchanged. `MessageMetaLine` holds the timestamp and the
  runtime in separate spans, and the runtime keeps its original render condition
  (`durationMs != null && durationMs > 0`). The existing `getByText('02:25')`
  assertions still pass and now act as the regression guard.
- Timestamps show a 24-hour clock time for messages from today ("13:23") and add
  the date for earlier days ("Sep 1st 26, 13:23"). Zen mode drops the timestamp
  and keeps the runtime.
- The runtime carries a unit indicator and no leading zero: "59s", "2:24m",
  "1:03h". A dot separates the segments of the meta line.
- Timestamp and runtime share one type scale. MessageSettingsBadges no longer
  sets its own size, so it inherits from the meta line.
- The "Last active" badge stays hidden below one hour, while the session sends,
  and on empty sessions. Hours become days at 36 h, so 36 h reads "2 days ago".
- Three runtime spans were duplicated across two files. They are now one component.
- Gate results: typecheck, eslint, and 2208 frontend tests pass. One Rust test
  fails, `windows_console_flash_audit`, from an uncommitted change in
  `jean-core/src/projects/commands.rs`. It is unrelated to this work.

---

# Add ASD-STE100 to Jean's global system prompt

- [x] Locate the synchronized Rust and TypeScript default prompts.
- [x] Add the exact ASD-STE100 instruction to both defaults.
- [x] Run focused tests and consistency checks.
- [x] Search GitHub issues and discussions for related reports.
- [x] Record review results and test steps.

## Review

- Added the exact instruction to the TypeScript preference default, the shared
  Rust preference default, and Claude's synchronized Rust fallback.
- Added assertions for both Rust prompt paths. The focused Rust test passed: 2
  tests, 0 failures.
- The prompt edit matches Prettier output, and the scoped diff check passed.
- The full Rust format check remains blocked by unrelated existing differences
  in `claude.rs`, `opencode.rs`, `codex_cli/commands.rs`,
  `http_server/server.rs`, and `projects/git_status.rs`.
- GitHub: no fully fixed, related, or similar issue or discussion was found for
  ASD-STE100, Simplified Technical English, or the global system prompt.

## How to test

- Open Settings → Magic Prompts and reset the global system prompt to its
  default. Confirm the ASD-STE100 sentence is the first instruction.
- Start a new Claude session and a new non-Claude session. Ask each agent to
  explain a technical topic. Confirm that each response uses short, direct,
  Simplified Technical English.

---

# Create a missing directory when adding a project (2026-08-09)

- [x] Trace the add-project and initialize-project path handling.
- [x] Add a failing regression test for a missing selected directory.
- [x] Create the directory before Jean validates the selected project path.
- [x] Run focused tests and quality gates.
- [x] Search GitHub issues and discussions and record the results.

## Design

- Keep directory creation in the Rust project boundary so native and web access
  use the same behavior.
- Create all missing parent directories before git-repository validation. Keep
  the existing error and Git initialization flow after the directory exists.
- Reject an existing file path as before.

## Review

- Root cause: `init_project` created a missing directory, but `add_project`
  validated the path first. A selected path that no longer existed stopped with
  `Path does not exist`, so the existing Git initialization flow did not open.
- `add_project` now creates the selected directory and all missing parents before
  Git validation. A non-repository directory then follows the existing Git init
  flow. `init_project` uses the same directory helper.
- The new regression test failed before the helper was added. Both directory
  tests now pass. Rust Clippy and `git diff --check` also pass.
- The full Rust format check remains blocked by unrelated existing format
  differences in Claude, OpenCode, Codex CLI, HTTP server, Jean MCP, and Git
  status files.
- GitHub: [#323](https://github.com/coollabsio/jean/issues/323) is similar because
  it concerns adding projects through web access, but this change does not fully
  fix that older client-versus-server selection report. No fully fixed or
  related issue or discussion was found.

## How to test

- In New Project, select or enter a path whose last directory does not exist.
  Confirm Jean creates it and continues to the Git initialization flow.
- Complete Git initialization. Confirm Jean adds the project and the new path is
  a directory with a `.git` repository.
- Select an existing file as the project path. Confirm Jean rejects it and does
  not replace the file.

---

# Fix hanging agent status

- [x] Trace Codex agent lifecycle events from parser to UI.
- [x] Add a failing regression test for a finished or interrupted agent.
- [x] Implement the smallest lifecycle fix and cover other backends if shared.
- [x] Run focused tests and `bun run check:all`.
- [x] Search GitHub issues and discussions for related reports.
- [x] Record review results and test steps.

## Review

- Root cause: Codex v2 emits `started`, `interacted`, and `interrupted` sub-agent
  activity, but it has no completed activity kind. Jean treated every unresolved
  agent as interrupted when a normal parent turn completed, so finished agents
  stayed at `0/N`.
- Fix: Treat a normal parent turn completion as completion for unresolved Codex
  agents. Preserve interrupted state when the assistant message is cancelled.
- Regression test: The focused Vitest file passes all 3 tests. The new assertion
  failed before the production change with `interrupted` instead of `completed`.
- Quality gates: TypeScript typecheck, ESLint, Prettier, and `git diff --check`
  passed. `bun run check:all` then stopped at Rust format checks because existing,
  unrelated Rust files do not match this toolchain's formatter output.
- GitHub: issue #590 is similar and discusses agent lifecycle inference. No exact
  issue or discussion for normal Codex completion was found.

## How to test

- Start a Codex turn that spawns an agent and let the parent turn finish normally.
- Confirm the Agents widget changes from `0/1` to `1/1` and shows Completed.
- Start another turn, spawn an agent, then cancel the parent turn.
- Confirm the agent shows Interrupted instead of Completed.

---

# Migrate Gemini backend to Antigravity CLI

- [x] Confirm the official Antigravity CLI install, auth, headless, session, model, permission, MCP, and structured-output contracts.
- [x] Replace the persisted backend identity and preferences with migration-safe Antigravity names.
- [x] Replace Gemini install, update, remove, PATH detection, version selection, authentication, model, and MCP commands with official `agy` behavior.
- [x] Replace the Gemini ACP engine with Antigravity `stream-json`, conversation resume, execution modes, cancellation, recovery, and tool-event parsing.
- [x] Migrate all one-shot and Magic Prompt routes to native `--json-schema` structured output.
- [x] Rename all frontend types, services, settings, labels, icons, models, and user-facing text to Antigravity CLI.
- [x] Register all renamed native and web-access commands and preserve old persisted data through aliases or migration fallbacks.
- [x] Update tests and documentation. Keep only intentional Gemini migration references.
- [x] Run focused tests, `bun run check:all`, format checks, and an installed-binary smoke test.
- [x] Search Jean GitHub issues and discussions for fixed, related, and similar reports.

## Migration design

- Use the official native `agy` binary. Jean-managed installs use the official release manifest and verified SHA-512 archives; System PATH resolves `agy` first and the documented `antigravity` executable as a compatibility alias.
- Use `agy -p --output-format stream-json` for chat and long operations. Persist the returned `conversation_id` and resume with `--conversation`.
- Map Plan to `--mode plan`, Build to `--mode accept-edits`, and Yolo to `--mode accept-edits --dangerously-skip-permissions`.
- Use `--output-format json --json-schema` for one-shot operations. Do not keep the Gemini ACP transport or its unsupported assumptions.
- Read MCP servers from Antigravity's documented global and workspace `mcp_config.json` files.
- Keep legacy `gemini` values only as deserialization and preference migration inputs. Do not show Gemini as a selectable backend.

---

# Antigravity extended capabilities

- [x] Parse the documented nested `tool_info` structure, including parameters, output, and tool errors.
- [x] Convert documented `subagent_info` entries into Jean agent activity tool calls.
- [x] Parse terminal result states and treat ERROR, INVALID, WAITING, and RUNNING as incomplete failures.
- [x] Treat CANCELED and INTERRUPTED terminal states as cancellation.
- [x] Import the documented latest workspace conversation from `last_conversations.json`.
- [x] Pass Jean effort levels to Antigravity.
- [x] Use Antigravity's terminal sandbox for Plan and Build.
- [x] Make Build usable in headless mode by auto-approving tools inside the sandbox; keep Yolo unsandboxed and fully approved.
- [x] Confirm that plugins, skills, rules, hooks, MCP, and subagents load automatically through the Antigravity harness.
- [x] Keep TUI-only features in the Login terminal instead of presenting non-working Jean controls.
- [x] Validate incomplete terminal states on the Windows attached-process path.
- [x] Capture headless soft-denial diagnostics and return a clear permission error.
- [x] Mark Antigravity subagents complete when the parent result completes successfully.
- [x] Ignore the model-list progress header instead of presenting it as a model.
- [x] Remove obsolete Gemini ACP tasks from this file.
- [x] Route persisted Antigravity run logs through the Antigravity stream parser.
- [x] Add a regression test that reconstructs assistant text from real Antigravity NDJSON.

## Review

- The official headless event schema now maps directly to Jean tool and agent UI data.
- The latest conversation for a workspace is discoverable from `~/.gemini/antigravity-cli/cache/last_conversations.json`; the complete remote history remains available only through `/resume`.
- Custom agents are usable by Antigravity and can spawn automatically. A persistent Jean `--agent` selector is not added because Jean sessions do not currently have an agent-profile preference contract.
- Plugins, skills, rules, hooks, projects, artifacts, `/diff`, `/fork`, `/rewind`, `/tasks`, and the full permission manager are Antigravity harness or TUI capabilities. They do not require duplicate Jean implementations to work during agent execution.
- Root cause of the empty completed response: live Antigravity streaming worked, but history reload used Jean's generic Claude-style run-log parser. That parser ignored Antigravity `step_update` and `result` events. The persisted conversation ID was correct and unrelated to the missing content.

---

## Shared backend settings redesign (2026-08-08)

- [x] Apply the Gemini section hierarchy, separators, spacing, and field cards to Claude, Codex, OpenCode, Cursor, PI, Command Code, Grok, and Kimi.
- [x] Add a shared responsive source-choice component instead of duplicating backend markup.
- [x] Replace source dropdowns with Jean-managed and System PATH cards for every backend that supports both sources.
- [x] Show each detected PATH binary and version in its source card.
- [x] Preserve backend-specific install, update, remove, authentication, model, reasoning, sandbox, and steering behavior.
- [x] Keep Cursor on its supported PATH-only flow while applying the shared section and card styling.
- [x] Add shared component and layout regression tests.

## Backend source action placement (2026-08-08)

- [x] Move each managed-install Uninstall action below the System PATH card.
- [x] Keep the source cards full width on desktop and mobile.

## Antigravity migration review (2026-08-08)

- Replaced the unreleased Gemini backend identity, settings, services, commands, session metadata, chat routing, Magic Prompts, MCP discovery, and all user-facing backend text with Antigravity CLI.
- Jean-managed installs now use Google's native installer and stable release manifest. System PATH detects `agy` and the documented executable alias. The current official manifest exposes one stable version, so the version chooser shows that version.
- Chat uses `stream-json`, persists `conversation_id`, resumes with `--conversation`, streams tool/thinking/usage events, runs detached on Unix, and uses Jean's process registry for cancellation.
- One-shot work uses Antigravity's native `--json-schema` and `structured_output` instead of Gemini prompt-only JSON repair.
- Legacy `gemini` backend, preference, CLI-source, and session fields migrate to Antigravity on read.
- Intentional Gemini text remains only for Gemini model names, Antigravity's documented `.gemini` configuration path, the official Gemini migration reference, and legacy migration aliases.
- Upstream interface limits: headless mode has no interactive approval or user-question surface, no in-turn steering API, no documented native-history file schema, and no MCP health command. Jean does not show false support for these features.
- Verification: TypeScript typecheck, ESLint, Rust compile, Clippy with warnings denied, 35 focused frontend tests, focused Rust Antigravity tests, and `git diff --check` passed. The full quality command stops only because the unchanged `src-server/src/main.rs` does not match the active formatter's trailing-newline output.
- Official binary smoke test: verified Antigravity CLI 1.1.11 flags for stream JSON, JSON Schema, conversations, modes, permissions, and models. The unauthenticated model check returned the documented sign-in message, which Jean detects.
- GitHub: [#175](https://github.com/coollabsio/jean/issues/175) is related but not fully fixed because it requests the old Gemini CLI. [#189](https://github.com/coollabsio/jean/issues/189) is a similar closed Gemini request. [#37](https://github.com/coollabsio/jean/issues/37) and [#432](https://github.com/coollabsio/jean/issues/432) are related but not fixed. No Antigravity or Gemini CLI discussion was found.

### How to smoke test

- Open Settings → Antigravity CLI. Test Jean managed install, version selection, Remove, System PATH, Refresh, Login, and Relogin.
- Sign in in the terminal, return to Settings, and confirm Installed, Authenticated, and account model options.
- Start Plan, Build, and Yolo sessions. Confirm Plan creates an approval card, Build follows configured permissions, and Yolo auto-approves.
- Cancel a long turn, close and reopen Jean during another long turn on macOS/Linux, and confirm the run log can be recovered.
- Send a second message and confirm the same Antigravity conversation continues.
- Set Antigravity for session naming, Save Context, commit, PR content, review, and release notes. Confirm each structured result is accepted.
- Add a server to `.agents/mcp_config.json` or `~/.gemini/config/mcp_config.json` and confirm it appears in Jean.

---

# Fix Antigravity effort and MCP integration (2026-08-08)

- [x] Add failing frontend tests that require Adaptive, Low, Medium, and High effort for Antigravity.
- [x] Route Antigravity selections through `effortLevel` and `agy --effort low|medium|high`.
- [x] Add failing Rust tests for Antigravity global MCP JSON installation.
- [x] Add Antigravity to Jean MCP and Agent Browser MCP automatic installers.
- [x] Make Antigravity MCP activation behavior honest: configured servers load automatically; do not claim unsupported runtime health.
- [x] Run focused frontend and Rust tests, quality gates, and an installed-CLI contract smoke test.
- [x] Search GitHub issues and discussions and record the review and smoke-test steps.

## Review

- Antigravity now uses its native effort contract only: Adaptive omits the flag; Low, Medium, and High pass `--effort low|medium|high`. Claude token-budget choices are not shown.
- Jean MCP and Agent Browser MCP can now be merged safely into `~/.gemini/config/mcp_config.json`, including onboarding and manual setup UI.
- Configured Antigravity MCP servers are shown as automatic and cannot be falsely disabled per session because `agy` has no documented runtime MCP override.
- Verification passed: 58 focused frontend tests, 17 focused Antigravity Rust tests, TypeScript, ESLint, Clippy with warnings denied, and `git diff --check`.
- `bun run check:all` reached the existing Rust formatter gate and stopped on unrelated pre-existing formatting differences in Claude, OpenCode, Codex CLI, HTTP server, and git-status files.
- GitHub: [#175](https://github.com/coollabsio/jean/issues/175) is related but not fully fixed because it requests Gemini CLI. [#211](https://github.com/coollabsio/jean/issues/211) is related unified MCP management work. [#430](https://github.com/coollabsio/jean/issues/430) is similar adaptive-thinking work. [#432](https://github.com/coollabsio/jean/issues/432) is similar Windows MCP work. No exact Antigravity issue or discussion was found.

## How to test

- Select Antigravity in chat. Open reasoning settings and confirm only Adaptive/Default, Low, Medium, and High appear.
- Send one turn at each explicit level and inspect the run/process log for `--effort low`, `--effort medium`, or `--effort high`. Adaptive must omit `--effort`.
- Open Settings → MCP Servers, enable Jean MCP, and use the one-click installer. Confirm `~/.gemini/config/mcp_config.json` contains `mcpServers.jean` or `mcpServers.jean-dev`.
- Install Agent Browser MCP and confirm `mcpServers.agent-browser` is in the same Antigravity config.
- Restart Jean and Antigravity, then send a prompt that requires one of the configured MCP tools. Confirm its tool call and result appear in chat.

---

# Handle Antigravity tool calls (2026-08-09)

- [x] Inventory real Antigravity `tool_info` names and parameter casing from persisted NDJSON.
- [x] Add failing renderer tests for Antigravity file, command, search, web, browser, agent, and task tools.
- [x] Normalize Antigravity tool names and PascalCase inputs to Jean's common renderers.
- [x] Preserve useful generic rendering for native Antigravity tools without a dedicated widget.
- [x] Run focused parser/UI tests and quality gates.
- [x] Search GitHub issues and discussions; record review and smoke-test steps.

## Review

- Root cause: Antigravity emits snake_case names such as `run_command`, `view_file`, and `write_to_file`, with PascalCase parameters such as `CommandLine`, `AbsolutePath`, and `TargetFile`. Jean's shared renderer knew similar tools but not these exact names or keys.
- File, edit, command, grep, glob, directory, web-search, and URL tools now use Jean's dedicated common renderers.
- Browser, image, terminal, knowledge-base, task, inbox, notification, and subagent tools now use a readable native Antigravity fallback instead of the unhandled warning.
- Verification passed: 77 focused UI tests, TypeScript, ESLint, and `git diff --check`.
- GitHub: [#573](https://github.com/coollabsio/jean/issues/573) and [#263](https://github.com/coollabsio/jean/issues/263) are similar unhandled-tool reports. No exact Antigravity issue or discussion was found.

## How to test

- Ask Antigravity to read and write a file, search the repository, and run a command. Confirm the rows show Read, Write/Edit, Grep/Glob, and Bash without an unhandled suffix.
- Ask Antigravity to search the web or read a URL. Confirm the row shows Web Search or Web Fetch with the query or URL.
- Use an Antigravity browser, task, subagent, terminal, or knowledge-base operation. Confirm it has a human-readable label and expandable details.

## 2026-08-09 — Antigravity selectable everywhere

- [x] Default backend (Settings General + project General) offers Antigravity when installed
- [x] Magic Prompts backend/model/effort + auto-defaults preset for Antigravity
- [x] Backend/model picker, MagicModal, ResolveConflicts, onboarding, search, MCP panes
- [x] Chat hooks: routing, effort, plan approval, hydration, labels, non-steerable queue
- [x] Rust: default_model_for_backend, jean_mcp_core backend lists, checkpoints, handoff, run_log plan injection
- [x] Verified: typecheck, eslint, clippy (lib), 2043 frontend tests, antigravity+module Rust tests

# Keep backend switch indicator on the changed prompt (2026-08-09)

- [x] Trace the persisted per-prompt backend data and reproduce the delayed separator.
- [x] Add a failing regression test for a prompt whose backend changed before its model metadata caught up.
- [x] Render the separator from the exact backend stored on the run.
- [x] Run focused tests and quality gates.
- [x] Search GitHub issues and discussions, then record results and test steps.

## Review

- Root cause: each run already stored its exact backend, but loaded user messages
  discarded that field. The separator inferred the backend from the model. A
  backend change could therefore use stale model metadata and appear one prompt
  late even though the correct backend handled the prompt.
- User messages now keep the run backend. Live optimistic messages also receive
  the selected backend. Old history without this field still uses model inference.
- The regression test failed with no separator before the fix and now passes.
- Verification passed: 37 focused frontend tests, 22 run-log Rust tests,
  TypeScript, ESLint, Rust compilation, and `git diff --check`.
- GitHub: no fully fixed, related, or similar issue or discussion was found.

## How to test

- Send a prompt with Codex, switch to Claude, and send the next prompt. Confirm
  `Codex → Claude` stays directly above that first Claude prompt.
- Send another Claude prompt. Confirm the separator does not move or repeat.
- Reload the session. Confirm the separator stays above the same prompt.

---

## Title bar Back / Go to / Forward (issue azeitler/jean#16)

- [x] Create issue https://github.com/azeitler/jean/issues/16
- [x] History store (`src/store/navigation-history-store.ts`) and recorder/replay (`src/lib/navigation-history.ts`)
- [x] Three buttons after the last left title bar button, fixed `ml-4` gap (desktop only)
- [x] `navigate_back` (`mod+[`) and `navigate_forward` (`mod+]`) keybindings
- [x] Tests: store, recorder, keybinding round trip

Result: typecheck, ESLint and focused tests pass. Not checked in a live app.

---

## Error notification for a failed pin or star (issue azeitler/jean#25)

- [x] `saveUIStateNow` in `src/services/ui-state.ts` — one write path, reports the outcome
- [x] `src/lib/ui-state-flush.ts` — serialized immediate write, snapshot at write time, no write before hydration
- [x] `src/lib/ui-state-snapshot.ts` — `getCurrentUIState` moved out of the hook (verbatim)
- [x] `src/components/chat/session-pin-actions.ts` — the four toggles revert and toast on failure
- [x] `isWsDisconnectError` moved to `src/lib/query-error.ts`
- [x] Tests: flush, actions, menu regression, `isWsDisconnectError`; two existing pin tests updated

Result: typecheck, ESLint, Prettier and the full frontend suite (2735 tests)
pass. Rust is untouched. Not checked in a live app: no Jean run environment
was available.

## How to test

- Right-click a session, then "Pin to Project". The pin stays and no toast
  comes up. Restart Jean: the pin is still there.
- Make the write fail (`chmod 444` on
  `~/Library/Application Support/com.jean.desktop/ui_state.json`, or stop the
  backend in web access). Pin a session: an error toast comes up and the pin
  goes away again. Repeat for Star and Unstar.
- With a failing write, drag the sidebar. No toast comes up (layout stays silent).

---

## Restore a cancelled prompt to the chat input (upstream coollabsio/jean#725)

Root cause: the backend and the frontend disagreed. `send_chat_message` throws a
cancelled turn away when the run made no output — it sets
`assistant_message_id = None`, which makes the run non-renderable, and pops the
user message. Its own comment says this is done so the frontend can restore the
text. But the frontend only restored on `chat:cancelled` with `undo_send: true`,
and the registry sets that flag only when no process ever started. A cancel of a
live run always sends `false`. The prompt was therefore lost from the history and
from the input.

Do not fix this by loosening the frontend rule to `undo_send || !hasContent`.
`hasContent` is a frontend guess and is false while the backend still holds output
the frontend never received. Upstream tried it, and reverted it in `a66fb1c6`
because it duplicated the prompt and brought image attachments back (upstream
issue #671, PR #717).

- [x] `jean-core/src/chat/claude.rs` — `UndoSendEvent` payload
- [x] `jean-core/src/chat/commands.rs` — emit `chat:undo-send` from the one branch
      that discards the turn, with the run id and the message
- [x] `jean-core/src/http_server/mod.rs` — buffer the event for a web reload
- [x] `src/types/chat.ts` — `UndoSendEvent` type
- [x] `src/components/chat/hooks/useStreamingEvents.ts` — `chat:undo-send` listener:
      skips a queued session, skips a non-empty draft, prefers `lastSentMessages`,
      falls back to `stripAllMarkers(user_message)`, restores attachments, and
      drops the stale turn from the query cache
- [x] Tests: four new cases; the two `chat:cancelled` regression tests are unchanged

Result: typecheck, ESLint, clippy, `jean-core` rustfmt, 2805 frontend tests and
1285 Rust tests pass. Not checked in a live app: no Jean run environment was
available.

Known gaps, not addressed: a steered prompt never sets `lastSentMessage`;
`cancel_processes_for_worktree` cancels idle sessions; the `chat:error` restore has
no empty-draft guard; app quit does not cancel or emit.

## How to test

- Send a prompt, then press stop as soon as the spinner starts, before the first
  word of the answer. The prompt comes back into the input, with its images.
- Send a prompt with an image, let it answer for some seconds, then press stop.
  The part of the answer stays in the history. The input stays empty.
- Send a prompt, press stop, then type new text quickly. Your new text stays.
- Send a prompt, type a second prompt to queue it, then press "Skip to Next".
  The input stays empty and the queued prompt runs.
- Send a prompt, then cancel it with the MCP `cancel_session_run` tool, or from
  another client. The prompt still comes back.
- Reload the window between the cancel and the restore. The prompt still comes
  back, because the event carries the text.

## Resolve chat file references against session evidence (2026-09-20)

A relative path in a chat answer, or an `@`-mention, resolved by one blind
join onto the worktree root. Wrong for a monorepo subdirectory, a linked
project, a path a tool printed relative to its own cwd, or a file that moved.
Nothing checked the file existed, so a dead reference looked like a live link.

- [x] Rust `resolve_file_reference(reference, candidates, searchRoot)` in
      `jean-core/src/projects/commands.rs`: stat each candidate in order, fall
      back to a bounded suffix search under the worktree
- [x] Register in `dispatch.rs` (jean-core command — dispatch arm only)
- [x] `src/lib/file-reference.ts`: candidate builder + evidence registry
      (a module Map keyed by worktree root, not a React context — a provider
      element around ChatWindow's tree re-indents 2,400 lines of it)
- [x] Evidence = absolute paths from `message.tool_calls[].input.file_path`
      (newest first), then worktree/linked-project roots
- [x] `useFileReference()` hook: resolving / found / ambiguous / missing
- [x] `MarkdownLink`: no link when missing, picker when ambiguous
- [x] `FileMentionBadge`: same resolution, disabled badge when missing
- [x] `openChatLink` accepts a resolved path
- [x] Invalidate `['file-reference']` when a turn finishes
- [x] Rust + TS tests, docs, changelog
- [x] Proof: 6 Rust tests, 26 frontend tests. 2928 frontend tests pass apart
      from the 3 model-picker failures that predate this work.

## Close "Recent activity" behind a click (2026-10-01)

The feed on Home and the project home showed little more than "Session
finished" rows and took a full Home column. Kept the feed and the backend log;
the section is closed by default.

- [x] `RecentActivitySection`: heading is a toggle, feed mounts only when open
      (no fetch while closed). Open state is component state, not persisted.
- [x] `HomeView`: activity moves under Recent sessions; grid is two columns
- [x] Tests (`HomeView`, `ProjectHomeColumns`), changelog
- [x] Proof: 86 tests in `components/home` + `components/dashboard` pass,
      `tsc --noEmit` clean, eslint clean on the changed files.

## Answer to a Claude question is lost (2026-10-01)

A `permission_prompt` request from the dialog shim can park after the
blocking-tool kill released the session. `resolve` then reported `true` for a
dead turn, so the UI skipped the follow-up message and stayed on "sending"
(session `c6ed9772`, tool `toolu_01J77LR2xS4xBGvKSCvh78aV`).

- [x] Failing tests in `claude_dialog.rs` (dead turn, live turn, nothing parked)
- [x] `claude_dialog::resolve_live`: deliver only when the session has a
      registered process; otherwise deny the orphan waiter and report `false`
- [x] `answer_claude_dialog` uses it and logs the result
- [x] Changelog
- [x] Proof: `cargo test --lib -- claude_dialog jean_mcp_socket` 17 pass.
- [ ] Manual check in the app (several questions in a row)

## 2026-10-13 Sidebar drag handle + sluggishness (A+B)

- [x] Project/folder drag starts only from the header row (`dragHandle`)
- [x] `list_all_sessions` skips archived worktrees
- [x] Hot `sessions` invalidations carry `worktreeIds`; frontend refreshes only those worktrees
- [x] `WorktreeItem` / `WorktreeList` subscribe to their own sessions only (`useSessionsCardStoreState`)
- [x] Proof: `bun run check:all` parts green (typecheck, lint, fmt, clippy, 384 TS test files, Rust tests)
- [ ] Manual check on the slow Mac

## 2026-10-13 Lean C

- [x] C1: session summary cache keyed by metadata.json mtime + size (`load_session_summary`)
- [x] C2: status sweep skips the projects.json write when counts are unchanged
- [x] Proof: `bun run check:all` green, 2 new Rust tests
- [ ] Manual check on the slow Mac

## 2026-10-13 Image viewer: mobile layout + pinch zoom

- [x] `react-zoom-pan-pinch` 4.2.0 in `ImagePreviewDialog` (pinch, double-tap, wheel, pan)
- [x] Mobile: full screen, image centered, safe-area padding for close/Reveal
- [x] Test `ImageLightbox.test.tsx`, changelog
- [x] Proof: `bun run check:all` green; Playwright 390×844 + 1280×800 screenshots, pinch → scale 2.5, wheel → scale 8
- [ ] Manual pinch on a real phone (web access)

## 2026-10-16 — Phone gap analysis, worktree sessions, keyboard spacing

- [x] Audit phone vs desktop gaps → `docs/developer/mobile-gap-analysis.md`
- [x] Canvas worktree row lists its sessions on a phone (`CanvasWorktreeSessions.tsx`)
- [x] Shell follows the visual viewport (`useVisualViewportShell`); no per-surface keyboard padding
- [x] Fix stale "Jean Chat" matcher in the e2e fixture (7 desktop e2e failures since the rename)
- Result: unit 3252/3252, e2e 46/46. Not checked on an iPhone: no simulator on this machine.
