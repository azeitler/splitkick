# Left context panel (Files | Network | Graph)

Issue #98. The panel left of the view content (right of the projects sidebar)
has three tabs about the session on screen:

| Tab     | Content                                                  | Disabled when |
| ------- | -------------------------------------------------------- | ------------- |
| Files   | `FileBrowserSidebar` (the file tree, unchanged)          | never         |
| Network | `SessionNetworkTree`: who started whom (#77), live       | no session    |
| Graph   | `SessionGraphPanel`: the session's graph card (#84, #88) | no session    |

A disabled tab stays visible (`aria-disabled`, reason in `title`); a stored tab
that cannot show anything renders its reason as content.

## Files

- `src/components/layout/ContextPanel.tsx`: tab bar, close button, content.
  Rendered by `MainWindow` (desktop, lazy, resizable) and by
  `MobileFileBrowser` (phone drawer).
- `src/components/layout/use-context-panel-shown.ts`: whether the panel is on
  screen. Home hides it without touching the stored visibility, except for a
  network pinned from a sidebar row.
- `src/lib/session-transfer.ts` → `useActiveSessionTarget()`: the session the
  Network and Graph tabs show (open session window, then active worktree, then
  selected worktree), the hook twin of `getActiveSessionTarget()`.

## State (`ui-store`)

- `fileBrowserVisible` / `fileBrowserSize`: panel visibility and width (names
  kept from the file tree; persisted as `file_browser_visible` /
  `file_browser_size`).
- `contextPanelTab`: active tab, persisted as `context_panel_tab` (UI state
  pattern; older state without it opens on Files).
- `sessionNetworkSessionId`: a network pinned by "Show Session Network" on
  another session. Cleared when the panel closes or a network row is opened.
- `openContextPanel(tab)`, `toggleContextPanel(tab)`: open, or close when the
  panel already shows `tab`. Callers: the title bar Files button and
  `Mod+Shift+B` (`files`), the Graph button, ⌘K "Toggle Graph Panel" and
  `Mod+Shift+G` (`graph`), `openSessionNetwork()` (`network`: context menu,
  the parent/child inserts, the "Started by" banner).

The old `chat-store.graphPanelVisible` and the session network dialog are
gone. The graph panel's visibility was never persisted, so nothing migrates.
