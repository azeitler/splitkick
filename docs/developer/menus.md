# Native Menu and Dock (macOS)

The macOS menu bar and the dock icon. Windows and Linux have no native menu;
every action stays reachable through keybindings, the command palette and the
title bar.

## Menu bar

Built in `src-tauri/src/app_menu.rs` (`create_app_menu`):

```
Jean     About, Check for Updates…, Settings…, Hide, Hide Others, Show All, Quit
File     New Session, New Session…, New Worktree, Add Project…, Open In…, Commit…,
         Close Session, Restore Last Archived
Edit     Undo, Redo, Cut, Copy, Paste, Select All, Find…
View     Toggle Left Sidebar / File Browser / Right Sidebar, Toggle Terminal / Browser,
         Git Diff, GitHub Dashboard, Zen Mode
Go       Back, Forward, Next / Previous Session, Unread Sessions, Focus Chat Input
Session  Run, Cancel Prompt, Label…, Clear Context
Window   Magic Menu, Quick Menu, Minimize, Zoom, (open windows)
Help     Feature Tour, Install AI Backends   (AppKit adds the menu search field)
```

### Item ids and events

| Id | Frontend event | Payload | Handled by |
|---|---|---|---|
| `kb:<action>` | `menu-keybinding` | keybinding action | `executeKeybindingAction` |
| `cmd:<command-id>` | `menu-command` | command id | `executeCommand` (`src/lib/commands/registry.ts`) |
| `about`, `check-updates`, `toggle-right-sidebar` | `menu-<id>` | none | own listener |
| `minimize` | none | none | Rust minimizes the focused window |

Events go to the focused window only (`install_menu_events`). The frontend
registers with `listenMenu` (`src/lib/transport.ts`), which takes the payload.
Listeners live in `src/hooks/useMainWindowEventListeners.ts`.

### Shortcuts follow the keybindings

Items are built **without** accelerators. The main window sends the effective
keybindings to `set_menu_accelerators` on load and on every change, and Rust
converts each one (`keybinding_to_accelerator`: `mod+shift+b` →
`CmdOrCtrl+Shift+B`). Shortcuts with no Cmd, Ctrl or Alt (`p`, `/`, plain
arrows) get no accelerator: they would fire from the menu while the user types.

Connection windows do not send their keybindings: the menu belongs to the app,
and the main window holds the local preferences.

### A key reaches both the web view and the menu

AppKit offers a key equivalent to the menu after the web view passed on it. The
web view passes on keys on purpose: an open dialog, a focused terminal, the
chat input owning Cmd+Enter. A menu accelerator would undo those decisions.

So the keydown handler records every shortcut (`recordShortcutKeydown`) and
`menu-keybinding` is dropped when its shortcut was pressed in the last second
(`isMenuEventFromPassedKey`). A click on the item has no keydown and always
runs. `MENU_ACTIONS_FROM_ANYWHERE` keeps the actions that must also work from a
terminal (terminal, browser, file browser, Magic Menu, Quick Menu, Settings).

### Adding a menu item

1. If it is a keybinding action, add `keybinding_item(app, "<action>", "Label")`
   in `create_app_menu`. Nothing else: the event, the handler and the shortcut
   come from the action.
2. If it is a command palette command, use `command_item(app, "<id>", "Label")`.
3. Use `…` (not `...`) when the item opens a dialog.

## Dock

`src-tauri/src/dock.rs`, fed by `useDockSync` (`src/hooks/useDockSync.ts`,
main window only, data from `src/lib/dock.ts`):

- **Badge:** `set_dock_badge(count)` — the unread count, the same number as the
  title bar bell (`countUnreadSessions`). `0` removes the badge.
- **Menu:** `set_dock_sessions(sessions)` — up to 8 sessions: unread first (with
  the reason, e.g. "· Input required"), then the most recently opened. Plus
  "New Worktree".

tao has no dock menu API. `dock::install` adds `applicationDockMenu:` to tao's
delegate class (`TaoAppDelegateParent`) at runtime with `class_addMethod`, then
sets the delegate again so NSApplication sees the new method. The menu is built
fresh each time the dock asks; a click reads its session from the snapshot of
the menu on screen.

A click on a session emits `open-session-request` (`SessionTarget`) to the main
window, which calls `navigateToSession`. Notification clicks use the same
event (see `notifications.md`).
