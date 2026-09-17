import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('RecentWorktreesList structure', () => {
  const source = readFileSync(
    'src/components/projects/RecentWorktreesList.tsx',
    'utf8'
  )

  it('shows ten recent worktrees before the expansion control', () => {
    expect(source).toContain('const INITIAL_RECENT_LIMIT = 10')
    expect(source).toContain('rows.slice(0, INITIAL_RECENT_LIMIT)')
    expect(source).toContain('Show {hiddenCount} more')
  })

  it('shows only project, worktree, and Git diff information in each row', () => {
    expect(source).toContain('{row.project.name}')
    expect(source).toContain('{row.worktree.name}')
    expect(source).toContain('+{row.added}')
    expect(source).toContain('-{row.removed}')
  })
})
