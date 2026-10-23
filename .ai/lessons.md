# Lessons

## Keep task tracking proportional

- The project instructions require work to be tracked in `.ai/todo.md`, but do not expand it with excessive implementation detail.
- For small follow-up fixes, add only a short checklist and result instead of a long duplicate report.
- Explain that `.ai/todo.md` is internal task tracking when the user asks why it changes.

## Normalize backend tool vocabularies at the display boundary

- Do not assume similar tools share names or parameter casing across backends.
- Capture real stream events, map exact backend names and keys to Jean's common renderer contract, and keep an explicit readable fallback for known native tools.
- Test both live-looking tool inputs and persisted inputs so reload does not reintroduce unhandled labels.

## Wire backend capability semantics end to end

- A backend flag is not supported until the frontend selects the correct setting type and every send path forwards it.
- For persistent-only MCP backends, add discovery and installers, but do not show a per-session switch that the CLI cannot honor.
- Test the exact CLI value set and the generated persistent config, not only the low-level command builder.

## Do not confuse incomplete work with upstream limits

- When the user asks for production readiness, classify each gap as either implementable in Jean or unavailable in the external backend.
- Do not call work complete while implementable checklist items remain.
- Do not use an upstream limitation to excuse adjacent Jean work that is still possible.
- State verification limits separately from implementation limits.

## Verify product migrations against the current official CLI

- Do not treat an old package registry entry as proof that a product is still the supported user path.
- Check the official product site, migration guide, installer, release manifest, and downloaded binary help before designing an integration.
- Do not rename an integration while keeping the old transport assumptions. Reclassify the backend from its current documented protocol.
- Do not install similarly named third-party packages. For Antigravity, use Google's official native installer and release manifest, not the unrelated npm package.

## Register live and history parsers together

- A new streaming backend needs two parser paths: the live response parser and the run-log reconstruction parser.
- Route persisted runs by the per-run backend or model prefix before using a generic fallback parser.
- Test history reload with the backend's real NDJSON format. Live streaming success does not prove that the response survives a query refresh or app reload.

## Rank palette and list entries by likely target, not by legacy order

- When a new entity type joins an existing list, do not default to appending it below the old entries only to protect existing muscle memory.
- Rank by which entry the user most probably wants. In a session-centric app, the last session beats the last project.
- Surface the ordering trade-off as an explicit choice before implementing, but recommend the likely-target order.

## Confirm the UI element exists before you plan a change to it

- A user who says "the chat shows a timestamp" can be describing something else.
  In the chat thread the only time-like text was the turn runtime (`02:25`), not a
  clock time.
- Grep for the concrete formatting call (`toLocaleTimeString`, `timeStyle`,
  `getHours`) before you plan an edit to a described element. If it does not exist,
  say so and give the user numbered options instead of guessing.
- A duration in `mm:ss` reads like a clock time. Expect this confusion again.
- When you add a value next to an existing one, keep each in its own element with
  its own render condition, so the new value cannot swallow the old one. Keep the
  test that asserts the old value visible - it is the regression guard.

## Send GitHub writes to the fork, never to upstream

- `gh` resolves this repository to the fork parent `coollabsio/jean`, not to
  `origin` (`azeitler/jean`). A bare `gh issue create` therefore posts upstream.
- Always pass `--repo azeitler/jean` on write commands: issues, discussions,
  pull requests, comments, labels, releases.
- Only target `coollabsio/jean` when the user asks for it in that message.
- A 404 on a write command against a repository you did not name is the signal
  that `gh` picked the wrong repository. Check `git remote -v` before you retry.
- See `CLAUDE.local.md` for the standing rule.

## A green local gate does not prove a green CI clippy

- CI installs the latest stable Rust (`dtolnay/rust-toolchain@stable`). The local
  `stable` can be many versions behind, and every new clippy adds lints. The
  v0.1.73-z.4 build failed on `clippy::unnecessary_sort_by` after `check:all`
  passed locally on 1.93 while CI ran 1.98.
- Before a push that cuts a release, run clippy with CI's version. Install it
  beside the default so nothing else changes:
  `rustup toolchain install <ver> --profile minimal -c clippy`, then
  `cargo +<ver> clippy ... -- -D warnings` for jean-core, src-server and
  src-tauri. The failed CI log names the version in its clippy help URL.

## Verify bulk GitHub writes; `gh` can drop them without an error

- `gh issue close N --comment ...` in a fast loop closed all 12 issues but posted
  only 3 of the 12 comments. The command exited 0 each time, so nothing showed
  the loss.
- After any bulk write, read the result back through the API (for example
  `gh api repos/<repo>/issues/N/comments`) and count. Space the writes out
  (a few seconds each) and check each one as you go.
- Never probe with a real comment on a real issue. If a probe is unavoidable,
  delete it straight away (`gh api -X DELETE repos/<repo>/issues/comments/<id>`).

## A click that should land on a view must win over auto-navigation

- Making the sidebar project row call `selectProject()` was not enough to show
  the project page. `ProjectCanvasView` reopens the last session on mount when
  `restore_last_session` is on (the default), and a canvas that is already
  mounted keeps its open session modal. Both made the click look broken for
  "some projects" only.
- Before you wire a click to a view, grep the target for mount effects that
  navigate away (`restore_*`, `autoOpen`, `lastOpened*`) and check the case
  where the target is already on screen. Check the user's own preferences
  file too — defaults hide the bug in tests.
- For a request that must reach a view which may mount later, use a one-shot
  UI-store flag the view consumes (like `pendingSidebarRevealId`), not a DOM
  event.

## A new view must fit its chrome, not only render its own content

- When you add a top-level view, check every surrounding surface in that state:
  side panels, title-bar toggles, sticky rows. The Home view first shipped with
  the Files panel open beside it, showing only "Select a project or worktree to
  browse files" - dead space. Gate such a panel on the view, and disable its
  toggle there, so the toggle never shows "pressed" over nothing.
- Hide it at render time. Do not write the persisted visibility preference, or
  the panel stays closed when the user goes back to a project.
- Align a new sidebar row with its visual neighbours, measured in the browser.
  Copying one row's classes is not enough when the tree already has two insets:
  root projects put their glyph at 8px, folders and section headers at 12px.
  Home copied the project row and so sat 4px left of the headers right under it.
- Dashboard content belongs in columns that answer to the view's own width
  (container queries), because the sidebar takes a variable share of the
  window. Narrow columns need two-line rows; one-line rows with a `shrink-0`
  context squeeze the name to a few characters.
- Never turn a query failure into an empty list. An empty feed renders
  "Nothing yet", which is false, and it caches as a success, so TanStack Query
  never retries. Rethrow and render a distinct error with a Retry control.

## When a shared helper gains a side effect, audit every caller

- `navigateToSession` gained a sidebar reveal for CMD+K (#9). The Pinned and
  Starred rows, which sit inside the sidebar, inherited it: a shortcut click
  expanded the original workspace and scrolled the tree away (#18).
- Before adding a side effect to a shared helper, grep every caller and ask
  whether each one wants it. Where the context differs, add an explicit
  option with the old behaviour as the default, and pass it at the callers
  that differ.
- A shortcut row that repeats an item elsewhere in the same view must not
  navigate the view to the original.

## "Active worktree" in the store is not the worktree on screen

- Relative image paths in chat resolved against
  `useChatStore.activeWorktreePath`. Tests passed, but in the app the images
  showed broken: a session opened from the project canvas renders in
  `SessionChatModal`, and the canvas clears the store's active worktree. The
  modal passes its own `worktreePath` prop to `ChatWindow` instead.
- Before code reads the active worktree from the store, check both chat
  surfaces: the full `ChatWindow` (store) and the canvas modal (props). The
  canvas modal is the default way to open a session.
- Pass the on-screen worktree down (props or a React context such as
  `LocalPathRootContext`), and keep the store only as a fallback. Test with
  the store value set to `null`.

## `bun run fix:all` rewrites the whole repository

- `fix:all` runs `eslint . --fix` and `prettier --write .`, both across every
  file. The repository is not Prettier-clean (`check:all` has no
  `format:check` step), so one run reformatted about 155 unrelated files and
  buried a 14-file change.
- Format only the files the change touches:
  `bunx prettier --write <paths>` and `bunx eslint --fix <paths>`.
- Use `bun run check:all` to verify. It never writes.
- If a whole-repo write already happened, list the intended files, then
  `git diff --name-only | grep -vxFf keep.txt` and `git checkout --` the rest.
  Never `git reset --hard`. Untracked files cannot be restored this way, so
  check their timestamps before assuming they survived.

## `emit_to` a window label does nothing on its own (Tauri v2)

- A JS listener registered with `listen(event, cb)` and no options registers
  `EventTarget::Any`, and `match_any_or_filter` short-circuits every emit
  filter. So switching Rust from `emit` to `emit_to(webview_window(label), …)`
  still delivers the event to every window.
- Both halves are needed: emit to the label **and** register the listener with
  `{ target: label }`. See `listenMenu` in `src/lib/transport.ts` and
  `install_menu_events` in `src-tauri/src/lib.rs`.

## A window built at runtime ignores `tauri.conf.json`

- `app.windows[0]` only describes the window Tauri creates at startup. A
  `WebviewWindowBuilder` has to repeat `minInnerSize`, `titleBarStyle`,
  `hiddenTitle` and the drag-drop handler, or the new window behaves
  differently from `main`.
- The builder method for `"dragDropEnabled": false` is
  `disable_drag_drop_handler()`, not `drag_drop_enabled(false)`.
- Reach the caller's window with a `window: tauri::Window` command parameter
  instead of `app.get_webview_window("main")`. Tauri injects it.

## `localStorage` is stubbed in the test setup

- `src/test/setup.ts` replaces `window.localStorage` with `getItem: vi.fn(() =>
null)`. Writing with `setItem` and reading it back returns `null`, so a test
  that needs real storage has to drive the mock with its own `Map`.
- Not every test has a full `window`. `vi.stubGlobal('window', { open: ... })`
  in `src/lib/platform.test.ts` has no `location`, so module-init code must use
  `window.location?.search`.

## A short follow-up like "can we try this with X?" is not a licence to guess

- A pronoun with no antecedent in the visible transcript means the context is
  gone, not that I should reconstruct the intent from the working tree. Reading
  git status plus the newest task file gives a plausible task, not the task.
- Ask which "this" is meant. One question costs a turn; a wrong guess costs a
  whole implementation, a real CLI run, and a revert.
- Untracked work has no safety net. `git checkout`/`restore` cannot undo an edit
  to a `??` file, so the only copy of the original is whatever I read earlier in
  the session. Read the whole file before editing it, and prefer reversing each
  edit precisely over rewriting the file from memory.
- `len(str)` counts characters, `wc -c` counts bytes. Do not conclude that a
  revert lost data because the two disagree on a file holding non-ASCII text.

## A file path I put in chat resolves against the worktree root, not the folder I am working in

- `openChatLink()` has no notion of a "current directory". A bare
  `01-plain.html` in an answer becomes `<worktree>/01-plain.html`. When I create
  files in a subfolder and then list them, I must write the path from the
  worktree root: `scratch/browser-fixtures/01-plain.html`.
- A markdown table of bare file names therefore produces a table of dead links,
  and the user reads that as a product bug.
- Inline code with a space in it is never autolinked (a command and a name with
  a space read the same), so a name with a space needs an explicit markdown
  link: `[04 report.html](<scratch/x/04 report.html>)`.

## Do not guess what a web view does with a file type — probe it

- A 40-line Swift `WKWebView` script with a `WKNavigationDelegate` answers
  "does this render, what MIME type, does the load finish" in one run, for
  every extension at once. `swift script.swift path...` needs no project.
- It found two things reading the code never would have: a movie reports the
  navigation as **failed** (`WebKitErrorDomain 204`) although it plays, and a
  `file://` text document is decoded as **Latin-1**, so UTF-8 Markdown shows
  mojibake. Both changed the design.
- Check the control case in the same run. The `.xhtml` fixture showed its
  em-dash correctly, which proved the mojibake was WebKit's decoding and not my
  probe's output encoding.

## An end-to-end test that skips Jean's stream parser proves nothing about the UI

- The Claude dialog harness passed a "real chain" test (real CLI, real shim, real socket) and still failed in the app: the plan was never presented. The test drove the CLI directly, so Jean's own stream consumer in `chat/claude.rs` never ran — and that consumer SIGKILLed the CLI on `ExitPlanMode`'s first, empty `input_json_delta`.
- Before claiming a chat UI flow works, replay a **real** CLI stream (with the same flags Jean passes, including `--include-partial-messages`) through the consumer logic. `scripts/claude-dialog-rig/replay_kill_paths.py` does this for the blocking-tool paths.
- Legacy code paths written while a feature was unreachable were never exercised. Re-read every handler that names the restored tools (`grep '"ExitPlanMode"'`) before shipping a restoration.
- CLI streaming behaviour drifts between versions: 2.1.231 streamed `ExitPlanMode`'s plan as deltas, 2.1.273 streams an empty input and injects `plan`/`planFilePath` into the final assistant message. Test against the version users run.
- When reading a stream-json log, find the `system/init` message by type — do not assume it is line 1. A `rate_limit_event` can come first and silently turn a present tool into an "absent" one.

## Complete a task by its name, not its number

- `bun run task:complete 1` moved a different `task-1-…` file: several tasks can share a priority number, and the script takes the first match. Always pass the unique name (`bun run task:complete restore-claude-dialog-tool-harness`) and check `git status docs/` afterwards.

## Diff a shared file before staging it whole

- `git add CHANGELOG.md` swept another session's uncommitted keychain entry into my commit, although its code was not committed. Caught it before the push only because a later grep looked for it.
- Before staging a file I edited, run `git diff <file>` and check every hunk is mine. `CHANGELOG.md` and `.ai/todo.md` are the usual suspects: several sessions append to them.
- `git add -p` is unavailable here. To commit part of a file, write the version I want, stage it, then restore the other hunks to the working tree (see the rebuild of `483fb431`).
- More than one session commits in this working tree. Check `git log <last-known>..HEAD` before committing, and confirm another commit did not take my hunks.

## Look at the screen, not only the tests

- The phone project modal passed 41 unit tests and 6 e2e tests, and still hid the corner FloatingDock: the new layer sat at `z-30` over the dock's `z-10`. Only a screenshot showed it.
- For layout work, capture the real screens (a throwaway Playwright spec on the e2e mock harness works) and compare them with what the user had before. Then add a guard for what the screenshot caught.
- The e2e mock preferences use `zoom_level: 1.0`, but the field is a percentage (50–200), so the harness renders at 50%. Override `zoom_level` / `mobile_zoom_level` to 100 for true-size screenshots.

## Kill a Claude turn only after the finished tool call is on disk

- The live parser and the history rebuild read the same run log, but not the same lines: the parser sees `stream_event` chunks, `run_log::parse_run_to_message` reads only finished `assistant` lines. Killing the CLI on the last streamed chunk (the "complete input" fix for the empty-plan bug) could land before the CLI wrote the `assistant` line, so the question survived live and vanished on every rebuild (azeitler/jean#32).
- A fix is not verified until both consumers agree. For any change to when Jean stops a CLI, replay a real stream (`scripts/claude-dialog-rig/replay_kill_paths.py`) and check that the run log up to the kill point rebuilds the same tool call the live view showed.

## Do not release a large upstream merge on green tests alone

- The upstream 1.0.1 merge (1cf20d58) passed every test and still broke the desktop app with remote servers: local command results got `local:` ids, so one session lived under two cache keys (answers missing, answers above questions, pinned rows switching on and off). It was reverted in 0.1.73-z.14.
- For a merge that changes routing, ids or transport: keep it on a branch, run the real desktop app with the user's remote servers enabled, and let an agent run in a pinned session before the merge reaches `main`. Web Access alone does not show it, because only the native main window combines servers.
- A JeanZ release cannot be undone by the updater: semver treats a lower upstream base (0.1.73 after 1.0.1) as older, so installed copies need a manual DMG install.

## The shell is zsh: an unquoted variable is one word

- `git add -- $FILES` with `FILES="a b c"` passed a single path in zsh, which does not split unquoted variables the way bash does. `git add` failed, the script carried on, and the commit held only the CHANGELOG. Caught from the commit stat and fixed with an amend.
- Use an array — `FILES=(a b c)` and `"${FILES[@]}"` — and end every critical step with `|| exit 1`, not `set -e` alone.
- After any scripted commit, read `git show --stat HEAD` before reporting it.

## Radix menu items select on a pointerup they never saw a pointerdown for

- `MenuItem` calls `event.currentTarget.click()` on any `pointerup` it did not receive a matching `pointerdown` for. That is press-drag-release, right for a dropdown and wrong for a context menu: the press that opened the menu landed on the trigger, so the release always matches, and an item sitting under the cursor runs without being chosen.
- To suppress one Radix behaviour without forking the primitive, pass the same handler as a prop and call `preventDefault()`. `composeEventHandlers` runs the caller's handler first and skips its own when the event is default-prevented — that is what `checkForDefaultPrevented` is for.
- `Presence` sits _inside_ `ContextMenuPrimitive.Portal`, so a shadcn `ContextMenuContent` wrapper never unmounts — only its children do. Per-open state has to live in a component rendered below that boundary, or it leaks from one opening into the next. A mount-lifecycle probe (`useEffect` logging mount/unmount) settles this in a minute; guessing does not.

## Another session can commit while you are staging

- Building a staged blob from `git show HEAD:<path>` and committing it later reverted two commits that had landed in between. The index was captured against an older HEAD, so the commit carried stale content for four files it never meant to touch.
- In a repo other Jean sessions write to, treat HEAD as volatile: re-read `git log -1` right before committing, prefer staging from the working tree over a remembered HEAD, and read `git show --stat HEAD` afterwards. The stat named eight files where four were expected, which is the only thing that caught it.
- The repair is `git reset --mixed <real tip>` — it rewinds the branch and the index and leaves the working tree alone, so the merged content survives and can be re-committed. Never `git reset --hard` here.

## Never `git stash` in a working tree another session shares

- To decide whether two failing tests were pre-existing, I stashed the whole tree, ran them against HEAD, and popped. For those seconds another session's entire uncommitted feature was gone from disk while it was working. It survived, but nothing about that was guaranteed — a pop conflicts, or the other session reads a file mid-stash and sees HEAD.
- To attribute a failure that is not in my own files, do not move the tree. Read `git diff --name-only` and check whether the failing test's subject is in someone else's hunks, or run the test from a throwaway `git worktree` on HEAD.
- `git commit -- <paths>` is the right shape for committing into a shared tree — it takes the working-tree content of those paths and leaves the rest of the index alone — but it rejects an untracked path, so `git add` must come first. Put both in one command so the window where my files sit staged is milliseconds. Options go before `--`: `git commit -F msg -- a b c`, never `git commit -- a b c -F msg`, where git reads `-F` as a pathspec.

## `bun run format` rewrites the whole repo, not your files

- The tree was committed with Prettier 3.6 and the lockfile now installs 3.8, whose defaults differ. `bun run format` after a four-file change produced a 157-file, 20k-line diff, including a 19k-line vendored JS bundle — my own change was buried in it. `format:check` fails repo-wide at HEAD, so a clean run proves nothing about your edits.
- Never run the repo-wide formatter to tidy an edit. Write the code in the style of the lines around it, then verify with `bunx prettier --check <the files you touched>`. If one warns, diff it against `git show HEAD:<path>` piped through the same check — a file that already failed at HEAD is drift, not your doing.
- Recovering costs more than the tidy was worth: `git diff --name-only` minus your own paths, then `tr '\n' '\0' | xargs -0 git checkout --` (macOS `xargs` has no `-a`). Your own files still carry the reformatting, so revert those too and re-apply the edits by hand.

## Find every place that derives a status before calling a status fix done

- A status bug can show in several views that each compute it. Fixing the shared helper does not fix a view that keeps its own copy of the logic.
- Before you fix a displayed status, grep for every consumer of the raw inputs (for example `waitingForInputSessionIds`, `waiting_for_input`) and list each view that shows the status: session rows, workspace row dot, project row, canvas, tabs.
- Make aggregate indicators derive from the per-item status helper (`computeSessionCardData`) instead of re-reading raw flags.
- Write a regression test against the view the user named ("the tree"), not only against the helper.

## Check real session data before calling a session-state bug fixed

- A unit test on one helper does not prove the user-visible bug is gone. Before shipping, read the persisted run metadata (`sessions/data/<id>/metadata.json`) and the live process arguments (`ps`) for the failing pattern.
- For "lost context" bugs, list each run's resume id next to the previous run's. A changed or missing id after a cancel shows the exact path that dropped it.
- Prefer making the invariant structural (Jean picks and saves the id before the spawn) over patching each place that might clear it.

## Check memory for the user's UI vocabulary before scoping

- The user calls the Jean title bar "menu bar" and also "toolbar". A memory note said so, but I scoped a macOS menu-bar job from the word alone.
- Before offering scope options that name a UI area, check memory notes for that word and name the exact component (`TitleBar.tsx` vs. the macOS menu) in the option text.

## A mockup approves everything it shows

- The unified-toolbar mockups also drew macOS-style sidebar rows. The spec scoped only the chrome, and I left the rows out silently. The user saw that gap after the build.
- Before writing a spec from approved mockups, list every visible difference between mockup and current UI, and mark each one in scope or out of scope in the spec. Ask about each one that is unclear.

## 2026-10-15 — GitHub posts on own repos need no approval
- User changed the global rule: issues, PRs, comments, labels, reviews on repos owned by `azeitler` or their orgs are posted directly, then reported with a link.
- Still ask for: other owners' repos (upstream `coollabsio/jean`), `git push`, releases, publishing, deploys.
- Fork is now `azeitler/splitkick` (renamed from `azeitler/jean`); use `--repo azeitler/splitkick`.

## Check sidebar geometry against the shared constants

- A new sidebar row or section must use the column constants in
  `sidebar-row-styles.ts`, not ad-hoc padding copied from a neighbour.
- Check both columns: the glyph and the label. A `gap-1.5` instead of `gap-1`
  moves the label 2 px even when the glyph lines up.
- Children of a section sit one step (16 px) in from the section header.
- A section header must not reuse the icon of its own rows.
- Verify with a screenshot and a per-row pixel scan of the first glyph and
  label columns, not by eye.
