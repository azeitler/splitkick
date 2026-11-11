import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

// Both surfaces that host a session right-click menu must pass projectId, or
// the pin item silently disappears on that surface.
const menuConsumers = [
  'src/components/chat/SessionChatModal.tsx',
  'src/components/projects/WorktreeItem.tsx',
  // Hosts the rows of the Pinned and Starred sections.
  'src/components/chat/SessionShortcutRows.tsx',
]

// Both surfaces that render the pinned list.
const pinnedSectionHosts = [
  'src/components/dashboard/ProjectCanvasView.tsx',
  'src/components/projects/WorktreeList.tsx',
]

describe('pin session to project', () => {
  it('offers pin and unpin on the shared session context menu', () => {
    const source = read('src/components/chat/SessionContextMenuItems.tsx')

    expect(source).toContain('Pin to Project')
    expect(source).toContain('Unpin from Project')
    // The menu delegates to the shared actions, which persist and report
    // failures; a bare store call here would fail silently again.
    expect(source).toContain('togglePinnedSession(')
    expect(source).toContain('toggleStarredSession(')

    const actions = read('src/components/chat/session-pin-actions.ts')
    expect(actions).toContain(
      'pinSessionToProject(projectId, sessionId, worktreeId)'
    )
    expect(actions).toContain('unpinSessionFromProject(projectId, sessionId)')
  })

  it('passes projectId from every session context menu consumer', () => {
    for (const path of menuConsumers) {
      const source = read(path)
      const menuUsage = source.slice(source.indexOf('<SessionContextMenuItems'))

      expect(menuUsage).toMatch(/projectId=\{/)
    }
  })

  it('renders the pinned section on the canvas and in the sidebar', () => {
    for (const path of pinnedSectionHosts) {
      const source = read(path)

      expect(source).toContain('<PinnedSessionsSection')
      expect(source).toContain('resolveProjectShortcutRows')
      // Both surfaces open a pinned session through the shared navigation helper.
      expect(source).toContain('navigateToSession')
    }
  })

  // A pinned or starred row is the same session as its row under the
  // workspace, so it must carry the same menu rather than a hand-rolled subset.
  it('gives pinned and starred rows the shared session menu', () => {
    const rows = read('src/components/chat/SessionShortcutRows.tsx')
    expect(rows).toContain('<SessionContextMenuItems')
    expect(rows).not.toContain('<ContextMenuContent')

    for (const path of [
      'src/components/chat/PinnedSessionsSection.tsx',
      'src/components/projects/SidebarStarredSection.tsx',
    ]) {
      const source = read(path)
      expect(source).toContain('<SessionShortcutRows')
      expect(source).not.toContain('<ContextMenuContent')
    }
  })

  // Pinned rows sit inside the tree: revealing the original row would scroll
  // the tree away from the click (#18). Starred and To-Do sit above the tree
  // and scroll on their own, so the tree follows them (2026-11-11).
  it('opens tree shortcut rows in place, and reveals from Starred and To-Do', () => {
    const pinned = read('src/components/projects/WorktreeList.tsx').match(
      /navigateToSession\(([\s\S]*?)\n\s{6}\)/
    )
    expect(pinned?.[1]).toContain('revealInSidebar: false')

    for (const path of [
      'src/components/projects/SidebarStarredSection.tsx',
      'src/components/projects/SidebarTodoSection.tsx',
      'src/components/dashboard/ProjectCanvasView.tsx',
    ]) {
      expect(read(path)).not.toContain('revealInSidebar: false')
    }
  })
})
