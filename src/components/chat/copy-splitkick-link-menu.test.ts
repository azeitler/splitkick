import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const menus: [path: string, kind: string][] = [
  ['src/components/chat/SessionContextMenuItems.tsx', 'session'],
  // The sidebar worktree menu takes its handler from useWorktreeMenuActions.
  ['src/components/projects/useWorktreeMenuActions.tsx', 'worktree'],
  ['src/components/projects/ProjectContextMenu.tsx', 'project'],
]

describe('Copy Link context menu items (#44)', () => {
  it.each(menus)('%s copies a %s link', (path, kind) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8')
    expect(source).toContain(`copySplitkickLink('${kind}'`)
  })

  it.each([
    'src/components/chat/SessionContextMenuItems.tsx',
    'src/components/projects/WorktreeContextMenu.tsx',
    'src/components/projects/WorktreeDropdownMenu.tsx',
    'src/components/projects/ProjectContextMenu.tsx',
  ])('%s shows a Copy Link item', path => {
    const source = readFileSync(join(process.cwd(), path), 'utf8')
    expect(source).toContain('Copy Link')
  })
})
