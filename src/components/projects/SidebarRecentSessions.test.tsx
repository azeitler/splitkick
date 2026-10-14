import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import type { AllSessionsEntry, Session } from '@/types/chat'
import {
  SIDEBAR_RECENT_LIMIT,
  SidebarRecentSessions,
} from './SidebarRecentSessions'

const mocks = vi.hoisted(() => ({
  entries: [] as AllSessionsEntry[],
  navigateToSession: vi.fn(),
}))

vi.mock('@/services/chat', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/chat')>()),
  useAllSessions: () => ({ data: { entries: mocks.entries } }),
  useRenameSession: () => ({ mutate: vi.fn() }),
  useArchiveSession: () => ({ mutate: vi.fn() }),
  useCloseSession: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/lib/navigate-to-session', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/navigate-to-session')>()),
  navigateToSession: mocks.navigateToSession,
}))

const HOUR = 60 * 60 * 1000

function session(id: string, name: string, activityAt: number) {
  return {
    id,
    name,
    order: 0,
    created_at: activityAt,
    updated_at: activityAt,
    messages: [],
  } as unknown as Session
}

function entry(project: string, worktree: string, sessions: Session[]) {
  return {
    project_id: `id-${project}`,
    project_name: project,
    worktree_id: `id-${worktree}`,
    worktree_name: worktree,
    worktree_path: `/tmp/${worktree}`,
    sessions,
  }
}

describe('SidebarRecentSessions', () => {
  beforeEach(() => {
    mocks.navigateToSession.mockClear()
    const now = Date.now()
    mocks.entries = [
      entry('Jean', 'main', [
        session('s-old', 'Old work', now - 10 * 24 * HOUR),
      ]),
      entry('Coolify', 'feat/deploy', [
        session('s-new', 'Deploy pipeline', now - 60_000),
      ]),
    ]
    useProjectsStore.setState({
      selectedWorktreeId: null,
      starredSessions: [],
      projectCanvasSettings: {},
    })
    useChatStore.setState({ sessionLabels: {}, activeSessionIds: {} })
  })

  it('lists sessions newest first with project / worktree on each row', () => {
    render(<SidebarRecentSessions />)

    const rows = within(screen.getByTestId('sidebar-recent-sessions'))
      .getAllByRole('button')
      .map(row => row.textContent)
    expect(rows[0]).toContain('Deploy pipeline')
    expect(rows[0]).toContain('Coolify / feat/deploy')
    expect(rows[1]).toContain('Old work')
    expect(rows[1]).toContain('Jean / main')
  })

  it('groups rows under day headings', () => {
    render(<SidebarRecentSessions />)

    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent(
      'Deploy pipeline'
    )
    expect(screen.getByRole('region', { name: 'Earlier' })).toHaveTextContent(
      'Old work'
    )
    expect(screen.queryByRole('region', { name: 'Yesterday' })).toBeNull()
  })

  it('opens a session without revealing it in the hidden tree', async () => {
    render(<SidebarRecentSessions />)

    await userEvent.click(screen.getByText('Deploy pipeline'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith(
      {
        projectId: 'id-Coolify',
        worktreeId: 'id-feat/deploy',
        sessionId: 's-new',
      },
      { revealInSidebar: false }
    )
  })

  it('highlights the open session', () => {
    useProjectsStore.setState({ selectedWorktreeId: 'id-feat/deploy' })
    useChatStore.setState({ activeSessionIds: { 'id-feat/deploy': 's-new' } })
    render(<SidebarRecentSessions />)

    const row = screen.getByText('Deploy pipeline').closest('button')
    expect(row).toHaveClass('bg-primary/10')
    expect(screen.getByText('Old work').closest('button')).not.toHaveClass(
      'bg-primary/10'
    )
  })

  it(`caps the list at ${SIDEBAR_RECENT_LIMIT} sessions`, () => {
    const now = Date.now()
    mocks.entries = [
      entry(
        'Jean',
        'main',
        Array.from({ length: SIDEBAR_RECENT_LIMIT + 5 }, (_, i) =>
          session(`s-${i}`, `Session ${i}`, now - i * 1000)
        )
      ),
    ]
    render(<SidebarRecentSessions />)

    expect(
      within(screen.getByTestId('sidebar-recent-sessions')).getAllByRole(
        'button'
      )
    ).toHaveLength(SIDEBAR_RECENT_LIMIT)
  })

  it('says so when there are no sessions', () => {
    mocks.entries = []
    render(<SidebarRecentSessions />)
    expect(screen.getByText('No sessions yet')).toBeInTheDocument()
  })
})
