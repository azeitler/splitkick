# Title bar Usage popover

Completed 2026-09-09. Commit `d3639b5f`
(`feat(titlebar): read plan usage from a title bar popover`), branch
`titlebar-cleanup`. No todo file preceded this task; it came from a direct
request, so the record starts here.

## Problem

Plan limits for Claude, Codex and Grok lived only in Settings → Account → Usage
(`src/components/preferences/panes/UsagePane.tsx`). To read a percentage, the
user had to open the Preferences dialog, which covers the whole app.

The floating dock has a usage dropdown
(`src/components/ui/floating-dock.tsx:593-660`), but it shows two numbers per
backend and its items only deep-link back into Settings. The dock also follows
the active session and is not always visible.

## Decision: a popover, not a modal

`UsagePane` takes no props and has no dialog chrome, no fixed width and no
scroll container of its own, so it drops into a popover unchanged.

A popover won over a `Dialog` because the content is a short read-only status
list, not a task. A modal would block the app for a glance at percentages. The
popover also matches the two title bar precedents, `CliUpdatesIndicator`
(`TitleBar.tsx:339-392`) and `UnreadBell`, and it needs no global open state, no
`MainWindow` mount and no lazy-import plumbing.

## Changes

**New `src/components/titlebar/UsagePopover.tsx`**

- `BarChart3` trigger in the title bar style: `h-6 w-6 rounded-none`, icon
  `size-3.5`, `bg-muted/50 text-foreground` while open (copied from the file
  browser toggle at `TitleBar.tsx:144`).
- Nesting order `Popover > Tooltip > TooltipTrigger asChild > PopoverTrigger
asChild > Button`, as in `CliUpdatesIndicator`.
- Content `align="start" side="bottom" sideOffset={4}`, `w-[22rem]`,
  `max-h-[70vh] overflow-y-auto p-3`.
- Header holds a "Usage" label and a Settings button that calls
  `useUIStore.getState().openPreferencesPane('usage')` then closes the popover.
- Local `useState` for the open flag. No store state, no Tauri command, no
  keybinding.

**`src/components/preferences/panes/UsagePane.tsx`**

- New optional prop `withSectionIds` (default `true`). `CompactSection`'s
  `anchorId` is now optional.
- The popover passes `false`, so the `pref-usage-section-claude|codex|grok` ids
  cannot appear twice in the document. Those ids are the jump targets for
  preferences search (`src/components/preferences/preferences-search.ts:679-715`),
  and a duplicate would break the jump when both surfaces are open.

**`src/components/titlebar/TitleBar.tsx:186`**

- Mounts `<UsagePopover />` after the Settings button, before
  `{native && <RemoteConnectionsDialog />}`.

## Notes for later

- **Drag region needed no work.** The left action group already sets
  `WebkitAppRegion: 'no-drag'` on its wrapper (`TitleBar.tsx:100`) and
  `relative z-10` on the button row (`:110`), so a new child inherits both.
- **Z-order was already correct.** `PopoverContent` is `z-[80]`
  (`src/components/ui/popover.tsx:33`), above the native title bar's `z-[60]`.
- **No extra backend cost.** The pane reuses the query keys
  `['claude-cli','usage']`, `['codex-cli','usage']` and `['grok-cli','usage']`
  that the dock already holds. Because the content unmounts on close, it adds no
  background polling — better than the Settings pane, which fetches whenever the
  pane is shown, even in dev.
- **The dock dropdown stays.** It is session-scoped; the title bar entry is
  global. `mod+u` (`open_usage_dropdown`) still opens the dock menu. Pointing it
  at both would open two menus at once.

## Verification

- `bun run typecheck` clean; `bun run test:run` 2285 tests in 317 files pass.
- New `src/components/titlebar/UsagePopover.test.tsx` (3 tests): the pane stays
  unmounted until the trigger is clicked, it renders without the search anchors,
  and the Settings button sets `preferencesOpen`/`preferencesPane` and closes.
- Two tests added to `UsagePane.test.tsx`: anchors present by default, absent
  with `withSectionIds={false}`.
- ESLint is clean on the changed files. Two full-repo runs failed on
  `WorktreeItem.tsx` / `ProjectTreeItem.tsx`, unrelated files that another
  process was writing at the time; ESLint read them half-written.
- Manual checks were left to the user (Jean MCP `get_run_environments` was not
  available in that session): popover placement, the Settings hand-off, the
  preferences search jump with both surfaces open, macOS click-vs-drag, and
  Escape / outside-click dismissal.

## Related issues

No issue is fully fixed by this change.

- Related: [coollabsio/jean#383 — Show session token usage / context window size
  in chat toolbar](https://github.com/coollabsio/jean/issues/383). Different
  scope: per-session tokens in the chat toolbar, not plan limits.
- Similar: [coollabsio/jean#164 — Show OpenCode Go plan
  usage](https://github.com/coollabsio/jean/issues/164) (closed). Same subject,
  but about an OpenCode backend rather than this entry point.
