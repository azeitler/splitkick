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
    expect(source).toContain('Older worktrees ({hiddenCount})')
    expect(source).toContain('className="min-h-0 flex-1 overflow-y-auto"')
    expect(source).toContain(
      'className="shrink-0 border-t border-border/40 p-2"'
    )
  })

  it('shows only project, worktree, and Git diff information in each row', () => {
    expect(source).toContain('{row.project.name}')
    expect(source).toContain('{row.session.name}')
    expect(source).toContain('+{row.added}')
    expect(source).toContain('-{row.removed}')
  })
})
