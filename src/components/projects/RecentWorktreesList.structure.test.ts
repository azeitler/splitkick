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
    expect(source).toContain('Show snoozed sessions')
    expect(source).toContain('Snoozed · inactive for 24 hours')
    expect(source).toContain('isSnoozedSession(row.lastActivityAt)')
  })

  it('shows session, project, worktree, activity, and Git diff information', () => {
    expect(source).toContain('{row.session.name}')
    expect(source).toContain('namingSessionIds[row.session.id]')
    expect(source).toContain("'Generating…'")
    expect(source).toContain('{row.projectName} · {row.worktree.name}')
    expect(source).toContain('formatRecentActivity(row.lastActivityAt)')
    expect(source).toContain('+{row.added}')
    expect(source).toContain('-{row.removed}')
    expect(source).toContain('fetchWorktreesStatus(projectId)')
    expect(source).toContain('text-[13px] font-medium')
    expect(source).toContain('text-[11px]')
  })

  it('renders recent sessions as separated cards', () => {
    expect(source).toContain('className="flex flex-col gap-2 px-2 py-2"')
    expect(source).toContain('rounded-lg border border-border/50 border-l-2')
    expect(source).toContain('bg-card/40')
    expect(source).toContain('shadow-sm')
    expect(source).not.toContain('divide-y divide-border/30')
  })

  it('keeps current-row, keyboard, partial failure, and accessibility behavior', () => {
    expect(source).toContain('event.metaKey')
    expect(source).toContain("['ArrowUp', 'ArrowDown']")
    expect(source).toContain('getAdjacentRecentRow(')
    expect(source).toContain('displayedRows,')
    expect(source).not.toContain('ignoresNavigationShortcut')
    expect(source).toContain('event.stopPropagation()')
    expect(source).toContain('{ capture: true }')
    expect(source).toContain("aria-current={isCurrent ? 'page' : undefined}")
    expect(source).toContain('aria-label="Recent sessions"')
    expect(source).toContain('Some recent sessions could')
    expect(source).toContain('selectedSessionId')
    expect(source).toContain('getRecentSessionStatus(row.session')
    expect(source).toContain("status.tone === 'working'")
    expect(source).toContain('executingModes[row.session.id]')
    expect(source).toContain('executionModes[row.session.id]')
    expect(source).toContain('row.session.last_run_execution_mode')
    expect(source).toContain('border-l-destructive')
    expect(source).toContain('border-l-yellow-500')
    expect(source).toContain("status.tone === 'completed'")
    expect(source).toContain('border-l-green-500')
    expect(source).toContain("!['working', 'completed'].includes(status.tone)")
  })

  it('does not create a different cached list for each selected session', () => {
    expect(source).toContain(
      "queryKey: ['recent-worktrees', projectKey, limit]"
    )
    expect(source).toContain('fetchRecentWorktrees(projects, limit, null)')
    expect(source).not.toContain(
      "queryKey: ['recent-worktrees', projectKey, limit, selectedSessionId]"
    )
  })

  it('keeps the snoozed footer stable during background refreshes', () => {
    expect(source).not.toContain('query.isFetching')
    expect(source).not.toContain('Updating…')
  })
})
