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
    expect(source).toContain(
      'pinSessionToProject(projectId, session.id, worktreeId)'
    )
    expect(source).toContain('unpinSessionFromProject(projectId, session.id)')
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
      expect(source).toContain('resolvePinnedSessionRows')
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

  // A pinned or starred row in the sidebar is a shortcut: opening it must not
  // expand the original workspace and scroll the tree to its row (#18). The
  // canvas and Home rows sit outside the tree and keep the reveal.
  it('opens sidebar shortcut rows without revealing the original row', () => {
    for (const path of [
      'src/components/projects/WorktreeList.tsx',
      'src/components/projects/SidebarStarredSection.tsx',
    ]) {
      const call = read(path).match(/navigateToSession\(([\s\S]*?)\n\s{6}\)/)

      expect(call?.[1]).toContain('revealInSidebar: false')
    }

    const canvas = read('src/components/dashboard/ProjectCanvasView.tsx')
    expect(canvas).not.toContain('revealInSidebar: false')
  })
})
