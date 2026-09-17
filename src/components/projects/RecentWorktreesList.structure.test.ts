import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('RecentWorktreesList structure', () => {
  const source = readFileSync(
    'src/components/projects/RecentWorktreesList.tsx',
    'utf8'
  )

  it('loads ten rows first and adds older rows in pages of 25', () => {
    expect(source).toContain('const INITIAL_RECENT_LIMIT = 10')
    expect(source).toContain('const RECENT_PAGE_SIZE = 25')
    expect(source).toContain('{Math.min(hiddenCount, RECENT_PAGE_SIZE)} more')
    expect(source).toContain('setLimit(value => value + RECENT_PAGE_SIZE)')
  })

  it('shows session, project, worktree, activity, and Git diff information', () => {
    expect(source).toContain('{row.session.name}')
    expect(source).toContain('{row.projectName} · {row.worktree.name}')
    expect(source).toContain('formatRecentActivity(row.lastActivityAt)')
    expect(source).toContain('+{row.added}')
    expect(source).toContain('-{row.removed}')
    expect(source).toContain('fetchWorktreesStatus(projectId)')
    expect(source).toContain('text-[13px] font-medium')
    expect(source).toContain('text-[11px]')
  })

  it('keeps current-row, keyboard, partial failure, and accessibility behavior', () => {
    expect(source).toContain('event.metaKey')
    expect(source).toContain("['ArrowUp', 'ArrowDown']")
    expect(source).toContain("aria-current={isCurrent ? 'page' : undefined}")
    expect(source).toContain('<ul aria-label="Recent sessions"')
    expect(source).toContain('Some recent sessions could')
    expect(source).toContain('selectedSessionId')
    expect(source).toContain('getRecentSessionStatus(row.session')
    expect(source).toContain("status.tone === 'working'")
    expect(source).toContain('border-l-yellow-500')
    expect(source).toContain("status.tone !== 'working'")
  })
})
