/**
 * Every app window is a webview, and a right-click anywhere without a menu of
 * its own showed WebKit's default menu: Reload, Inspect Element. Reload
 * throws away the window's state, so the guard blocks that menu.
 *
 * The native menu stays where it is useful: in text fields and editable
 * content (Cut, Copy, Paste, spelling) and on selected text (Copy, Look Up).
 *
 * The listener runs in the bubble phase on the window, after React's root
 * handlers, so an own menu (Radix ContextMenu) has already handled the event
 * and `defaultPrevented` is set. A capture-phase listener would block those
 * menus: Radix skips its handler when the default is already prevented.
 */
const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'

function keepsNativeMenu(event: MouseEvent): boolean {
  // composedPath()[0]: the real target inside a shadow root (Pierre's editor)
  const target = event.composedPath()[0]
  if (target instanceof Element && target.closest(EDITABLE)) return true
  if (target instanceof Node && target.parentElement?.closest(EDITABLE))
    return true
  const selection = document.getSelection()
  return selection !== null && !selection.isCollapsed
}

/** Installs the guard on `win` and returns a function that removes it. */
export function installNativeContextMenuGuard(win: Window): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented || keepsNativeMenu(event)) return
    event.preventDefault()
  }
  win.addEventListener('contextmenu', onContextMenu)
  return () => win.removeEventListener('contextmenu', onContextMenu)
}
