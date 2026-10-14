import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8')

describe('SessionChatModal removal behavior', () => {
  it('listens for command-palette session rename requests', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toMatch(
      /window\.addEventListener\(\s*'command:rename-session'/
    )
    expect(source).toMatch(
      /window\.removeEventListener\(\s*'command:rename-session'/
    )
  })

  it('keeps rename input out of the clickable tab button to avoid accidental close/cancel', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).not.toMatch(/<button\s+data-session-id=/)
    expect(source).toMatch(/<div\s+data-session-id=/)
    expect(source).toContain('onPointerDown={e => e.stopPropagation()}')
  })

  it('uses the delete-aware handler when removing non-last tabs', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')
    const start = source.indexOf('const removeSessionTab = useCallback(')
    const end = source.indexOf('\n  const handleTabAuxClick', start)
    const removeSessionTab =
      start === -1 || end === -1 ? '' : source.slice(start, end)

    expect(removeSessionTab).toBeTruthy()
    expect(removeSessionTab).toContain('handleDeleteSession(session.id)')
    expect(removeSessionTab).not.toMatch(
      /else\s*\{[\s\S]*?selectVisualNeighbor\(session\.id\)[\s\S]*?handleArchiveSession\(session\.id\)/
    )
  })

  it('confirms non-empty session tab close even when other tabs remain (issue #56)', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')
    const start = source.indexOf('const removeSessionTab = useCallback(')
    const end = source.indexOf('\n  const handleTabAuxClick', start)
    const removeSessionTab =
      start === -1 || end === -1 ? '' : source.slice(start, end)

    expect(removeSessionTab).toContain('needsConfirm')
    expect(removeSessionTab).toContain(
      'preferences?.confirm_session_close !== false && !sessionIsEmpty'
    )
    // Confirm gate wraps the action for every non-empty tab (not only last).
    expect(removeSessionTab).toMatch(
      /if \(needsConfirm\) \{[\s\S]*?pendingCloseAction\.current = action/
    )
    // Neighbor select happens inside the deferred action, not as a bypass.
    expect(removeSessionTab).toMatch(
      /const action = \(\) => \{[\s\S]*activeSessions\.length > 1[\s\S]*handleDeleteSession/
    )
  })

  it('waits for last-session removal success before leaving the modal', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')
    const start = source.indexOf('const removeSessionTab = useCallback(')
    const end = source.indexOf('\n  const handleTabAuxClick', start)
    const removeSessionTab =
      start === -1 || end === -1 ? '' : source.slice(start, end)

    expect(removeSessionTab).toContain('handleDeleteSession(session.id)')
    expect(removeSessionTab).not.toContain('onClose()')
    expect(removeSessionTab).not.toContain('navigateToProjectPicker(')
  })

  it('shows the empty worktree view after the last session is removed', () => {
    const modalSource = readSource('src/components/chat/SessionChatModal.tsx')
    const serviceSource = readSource('src/services/chat.ts')

    expect(modalSource).toContain(
      'No sessions yet. Create one to start chatting.'
    )
    expect(serviceSource).not.toContain('navigateToProjectPicker(')
    expect(serviceSource).toContain(
      'const { [worktreeId]: _removed, ...rest } = state.activeSessionIds'
    )
  })

  it('asks to close the worktree when Cmd+W is pressed with no sessions', () => {
    const modalSource = readSource('src/components/chat/SessionChatModal.tsx')
    const canvasSource = readSource(
      'src/components/dashboard/ProjectCanvasView.tsx'
    )

    expect(modalSource).toContain("setCloseConfirmMode('worktree')")
    expect(modalSource).toContain('onRequestCloseWorktree')
    expect(modalSource).toContain('mode={closeConfirmMode}')
    expect(canvasSource).toContain('onRequestCloseWorktree={() => {')
    expect(canvasSource).toContain(
      'closeWorktreeDirectly(selectedWorktreeModal.worktreeId)'
    )
  })

  it('hides session tabs and top action chrome when zen mode is active', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toContain('state => state.zenMode')
    expect(source).toContain('data-testid="toggle-zen-mode"')
    expect(source).not.toContain('{!(zenMode && isMobile) && (')
    expect(source).toContain('{!zenMode && sessions.length > 0 && (')
    expect(source).toContain('{!zenMode && (')
    expect(source).toContain('<ModalCloseButton onClick={handleClose} />')
  })

  it('uses Safari-style rounded tabs without dividers', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toContain('flex min-w-max items-center gap-1')
    expect(source).toContain(
      'group/tab flex h-6 w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs'
    )
    // The selected tab uses the sidebar's selection fill; no boxed dividers.
    expect(source).toContain("cn(SIDEBAR_ROW_SELECTED, 'font-medium')")
    expect(source).not.toContain('border-r border-border px-3')
  })

  it('shows the tab shortcuts only while the mod key is held', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toContain('useModKeyHeld()')
    expect(source).toContain('idx < 9 && showTabShortcuts')
  })

  it('keeps the new session button after the tabs until they overflow on desktop', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toContain(
      '<ScrollArea\n                className="min-w-0 flex-1 sm:flex-initial"'
    )
  })

  it('reattaches horizontal tab scrolling after leaving zen mode', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toMatch(
      /viewport\.addEventListener\('wheel',[\s\S]*\}, \[sessions\.length, zenMode\]\)/
    )
  })

  it('keeps only the zen control in the mobile header', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')
    // Clearing asks for confirmation first; the dialog owns the mutation.
    const dialog = readSource(
      'src/components/chat/ClearContextConfirmDialog.tsx'
    )

    expect(source).toContain('requestClearSessionContext(')
    expect(source).toContain('handleClearContext')
    expect(source).toContain('data-testid="toggle-zen-mode"')
    expect(source).not.toContain('aria-label="Clear context"')
    expect(source).not.toContain('data-testid="clear-session-context"')
    expect(dialog).toContain('useClearSessionHistory')
    expect(dialog).toMatch(
      /onSuccess:\s*\(\)\s*=>\s*window\.dispatchEvent\(new CustomEvent\('focus-chat-input'\)\)/
    )
  })

  it('falls back to a real session when restored active session state is stale', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toMatch(
      /resolveModalSessionId\(\s*activeSessionId,\s*sessions\.map\(session => session\.id\)\s*\)/
    )
  })

  it('marks waiting session tabs in yellow', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toContain('isActionableWaitingStatus(status)')
    expect(source).toContain("'text-yellow-700")
  })

  it('sets only inactive unread session tabs in semibold', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toContain('isUnreadSession(session)')
    expect(source).toContain('!isActive')
    expect(source).toContain('!isActionableWaitingStatus(status)')
    expect(source).toContain("'font-semibold text-foreground'")
    expect(source).not.toContain("'bg-green-500/10")
  })

  it('offers to open resumable chat sessions in a separate native client session', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')

    expect(source).toContain('buildNativeClientSessionInput')
    expect(source).toContain('handleOpenInNativeClient')
    expect(source).toMatch(
      /reconnectNativeCliSession\(nativeSession, worktreeId, \{[\s\S]*?openModal: false/
    )

    // The menu item itself lives in the shared session context menu.
    const menuSource = readSource(
      'src/components/chat/SessionContextMenuItems.tsx'
    )
    expect(menuSource).toContain('Open in Native Client')
    expect(menuSource).toContain('onOpenInNativeClient')
  })
})
