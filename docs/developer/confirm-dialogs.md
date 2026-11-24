# Confirmation Dialogs for Destructive Actions

Every UI action and keyboard shortcut that destroys or loses data or work asks
first, in one shared dialog: `src/components/ui/confirm-dialog.tsx`.

## Rules

- The title names the object: `Delete session “Acme”?`. One sentence of
  consequence follows.
- The confirm button has focus, so **Return confirms**. **Esc cancels**, and
  Esc does not reach window-level handlers (it closes only the dialog).
- Destructive actions use the red confirm button. Reversible ones (archive)
  use the default button.
- A key that was down when the dialog opened cannot confirm it: the Return
  that picked a menu item, its WebKit `keypress`, a Space `keyup`, and
  auto-repeat are ignored. A confirm fires once per opening.
- A shortcut opens the same dialog as the menu item. It never acts directly.
- Keys inside the dialog do not bubble (through the React portal) to the
  component that rendered it.

## Three ways to use it

1. **Imperative** (most call sites): `confirmAction({ title, description,
confirmLabel })` resolves `true` on confirm, `false` on cancel; return
   early on `false`. `<ConfirmDialogHost />` is mounted once in `MainWindow`
   (and in the test `render` wrapper). Helpers for actions with several entry
   points live in `src/lib/destructive-confirms.ts`.
2. **Component**: `<ConfirmDialog open onOpenChange title … onConfirm />` for
   dialogs whose state already lives in a component. `children` adds content
   (a settings link); `closeOnConfirm={false}` + `confirmDisabled` for busy
   actions that close themselves.
3. **Hook**: `useConfirmKeyboard({ open, onConfirm, disabled })` for dialogs
   with their own layout (checkpoint restore, merge to base). Spread
   `contentProps` on `AlertDialogContent`, put `confirmRef` on the confirm
   button. `open` can be one step of a larger dialog (the approval step).

## What does not ask

- **Archive** (session or worktree, from its menu item): it can be undone from
  the Archived view and with "Restore last archived". When the removal
  preference is `delete`, the same items delete for real and do ask.
- **Close with `confirm_session_close` off**: that preference is the existing
  "don't ask again" switch for close/archive by Cmd+W, tab close and
  middle-click. It keeps working.
- **Anything in the chat flow**: cancelling a run (stop button, the cancel
  shortcut, "Skip to Next" with queued messages, the canvas), "Send now" on a
  queued prompt, skipping or answering a question. These are frequent and keep
  the output so far; a dialog there interrupts the work. (1.6.0 asked before
  cancelling a run; 1.6.1 removed it.)
- **MCP tools** (`archive_session`, `delete_worktree`, `cancel_session_run`,
  …): an agent has no one to click a dialog. Agents are told in the MCP
  instructions to ask the user in chat first.

## Tests

`render` from `@/test/test-utils` mounts the host. Use `await confirmDialog()`
and `await cancelDialog()` to answer it. Every guarded action has a cancel test
(nothing happens) and a confirm test (the action runs).
