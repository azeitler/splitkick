import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test/test-utils'
import { WorktreeItem } from './WorktreeItem'
import type { Worktree } from '@/types/projects'
import type { Session } from '@/types/chat'
import { useProjectsStore } from '@/store/projects-store'
import { SidebarWidthProvider } from '@/components/layout/SidebarWidthContext'

const mocks = vi.hoisted(() => ({
  sessions: [] as Session[],
}))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/useRemotePicker', () => ({
  useRemotePicker: () => (run: (remote?: string) => void) => run(),
  pushNeedsRemotePicker: () => false,
}))
vi.mock('@/hooks/useWorktreeTerminalStatus', () => ({
  TerminalStatusIndicator: () => null,
  useWorktreeTerminalStatus: () => ({ running: false, failed: false }),
}))

vi.mock('@/services/chat', () => ({
  useSessions: () => ({
    data: {
      worktree_id: 'wt-1',
      sessions: mocks.sessions,
      active_session_id: null,
      version: 2,
    },
  }),
  useRenameSession: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/services/projects', () => ({
  useRenameWorktree: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/services/git-status', () => ({
  useGitStatus: () => ({ data: null }),
  gitPush: vi.fn(),
  fetchWorktreesStatus: vi.fn(),
  triggerImmediateGitPoll: vi.fn(),
  performGitPull: vi.fn(),
  performGitSync: vi.fn(),
}))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: null }),
}))

vi.mock('./useWorktreeMenuActions', () => ({
  useWorktreeMenuActions: () => ({
    handleArchiveOrClose: vi.fn(),
    preferences: null,
  }),
}))
vi.mock('./WorktreeContextMenu', () => ({
  WorktreeContextMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('@/components/chat/hooks/useSessionArchive', () => ({
  useSessionArchive: () => ({
    handleArchiveSession: vi.fn(),
    handleDeleteSession: vi.fn(),
  }),
}))
vi.mock('@/components/chat/SessionContextMenuItems', () => ({
  SessionContextMenuItems: () => null,
  closeOpenSessionContextMenus: vi.fn(),
}))
vi.mock('@/components/chat/LabelModal', () => ({ LabelModal: () => null }))
vi.mock('@/components/chat/CloseWorktreeDialog', () => ({
  CloseWorktreeDialog: () => null,
}))

const worktree: Worktree = {
  id: 'wt-1',
  project_id: 'project-1',
  name: 'feature',
  path: '/tmp/jean-feature',
  branch: 'feature',
  created_at: 0,
  order: 0,
  status: 'ready',
  session_type: 'worktree',
}

function session(
  id: string,
  name: string,
  overrides: Partial<Session> = {}
): Session {
  return {
    id,
    name,
    order: 0,
    created_at: 0,
    updated_at: 0,
    messages: [],
    ...overrides,
  } as Session
}

function renderItem(props: Partial<React.ComponentProps<typeof WorktreeItem>>) {
  return render(
    <WorktreeItem
      worktree={worktree}
      projectId="project-1"
      projectPath="/tmp/jean"
      defaultBranch="main"
      {...props}
    />
  )
}

describe('WorktreeItem session filter', () => {
  beforeEach(() => {
    mocks.sessions = [
      session('a', 'Auth Refactor'),
      session('b', 'Billing dashboard'),
    ]
    useProjectsStore.setState({
      selectedWorktreeId: null,
      expandedWorktreeIds: new Set(['wt-1']),
    })
  })

  it('narrows the rendered session rows as you type', async () => {
    const user = userEvent.setup()
    renderItem({})

    expect(screen.getByText('Auth Refactor')).toBeInTheDocument()
    expect(screen.getByText('Billing dashboard')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.type(screen.getByTestId('worktree-session-filter-wt-1'), 'auth')

    await waitFor(() =>
      expect(screen.queryByText('Billing dashboard')).toBeNull()
    )
    expect(screen.getByText('Auth Refactor')).toBeInTheDocument()
  })

  it('reveals sessions of a collapsed row without expanding it', async () => {
    useProjectsStore.setState({ expandedWorktreeIds: new Set() })
    renderItem({ sessionFilterQuery: 'auth' })

    expect(screen.getByText('Auth Refactor')).toBeInTheDocument()
    expect(screen.queryByText('Billing dashboard')).toBeNull()
    expect(useProjectsStore.getState().expandedWorktreeIds.size).toBe(0)
  })

  it('lets a local filter override the inherited project filter', async () => {
    const user = userEvent.setup()
    renderItem({ sessionFilterQuery: 'auth' })

    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.type(
      screen.getByTestId('worktree-session-filter-wt-1'),
      'billing'
    )

    await waitFor(() =>
      expect(screen.getByText('Billing dashboard')).toBeInTheDocument()
    )
    expect(screen.queryByText('Auth Refactor')).toBeNull()
  })

  it('reports when nothing matches', async () => {
    const user = userEvent.setup()
    renderItem({})

    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.type(
      screen.getByTestId('worktree-session-filter-wt-1'),
      'zzzzzzzz'
    )

    await waitFor(() =>
      expect(screen.getByText('No matching sessions')).toBeInTheDocument()
    )
  })

  it('clears its own filter and the project filter once a session is picked', async () => {
    const onSessionSelected = vi.fn()
    const user = userEvent.setup()
    renderItem({ onSessionSelected })

    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.type(screen.getByTestId('worktree-session-filter-wt-1'), 'auth')
    await waitFor(() =>
      expect(screen.queryByText('Billing dashboard')).toBeNull()
    )

    await user.click(screen.getByText('Auth Refactor'))

    expect(onSessionSelected).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('worktree-session-filter-wt-1')).toBeNull()
    expect(screen.getByText('Billing dashboard')).toBeInTheDocument()
  })

  it('hides the filter toggle for a workspace with no sessions', () => {
    mocks.sessions = []
    renderItem({})

    expect(screen.queryByRole('button', { name: 'Filter sessions' })).toBeNull()
  })
})

describe('WorktreeItem stale fade', () => {
  const DAY = 24 * 60 * 60 * 1000

  function rowFor(name: string): HTMLElement {
    const row = screen.getByText(name).closest('[class*="pl-5"]')
    if (!row) throw new Error(`no session row for ${name}`)
    return row as HTMLElement
  }

  beforeEach(() => {
    useProjectsStore.setState({
      selectedWorktreeId: null,
      expandedWorktreeIds: new Set(['wt-1']),
    })
  })

  it('fades a session untouched for over two days and leaves a recent one alone', () => {
    mocks.sessions = [
      session('old', 'Stale work', { last_message_at: Date.now() - 30 * DAY }),
      session('new', 'Fresh work', { last_message_at: Date.now() - DAY }),
    ]
    renderItem({})

    expect(rowFor('Stale work').className).toContain('opacity-50')
    expect(rowFor('Fresh work').className).not.toContain('opacity-50')
  })

  // The reported case: a few days old, finished, and still at full weight
  // under the old seven-day threshold.
  it('fades a session a few days old', () => {
    mocks.sessions = [
      session('recent', 'Three days old', {
        last_message_at: Date.now() - 3 * DAY,
      }),
    ]
    renderItem({})

    expect(rowFor('Three days old').className).toContain('opacity-50')
  })

  // Regression: the fade was gated on session status as well as age. Status is
  // derived from persisted state, so a session abandoned mid-question reports
  // `waiting` forever and stayed bright beside equally dead idle rows.
  it('fades equally old sessions alike, whatever state they were left in', () => {
    const longAgo = Date.now() - 30 * DAY
    mocks.sessions = [
      session('idle', 'Left idle', { last_message_at: longAgo }),
      session('asking', 'Left mid-question', {
        last_message_at: longAgo,
        waiting_for_input: true,
      }),
      session('planning', 'Left mid-plan', {
        last_message_at: longAgo,
        pending_plan_message_id: 'msg-1',
      }),
    ]
    renderItem({})

    for (const name of ['Left idle', 'Left mid-question', 'Left mid-plan']) {
      expect(rowFor(name).className).toContain('opacity-50')
    }
  })
})

describe('WorktreeItem linked issue badge', () => {
  beforeEach(() => {
    mocks.sessions = [session('a', 'Auth Refactor')]
    useProjectsStore.setState({
      selectedWorktreeId: null,
      expandedWorktreeIds: new Set(['wt-1']),
    })
  })

  it('marks every session row of a workspace made from an issue', () => {
    mocks.sessions = [session('a', 'Auth Refactor'), session('b', 'Follow-up')]
    renderItem({ worktree: { ...worktree, issue_number: 123 } })

    const badges = screen.getAllByTestId('linked-issue-badge')
    expect(badges).toHaveLength(2)
    expect(badges[0]).toHaveTextContent('123')
  })

  it('shows no badge for a workspace with no linked issue', () => {
    renderItem({})

    expect(screen.queryByTestId('linked-issue-badge')).toBeNull()
  })

  it('drops the badge on a narrow sidebar, where the row has no room', () => {
    render(
      <SidebarWidthProvider value={150}>
        <WorktreeItem
          worktree={{ ...worktree, issue_number: 123 }}
          projectId="project-1"
          projectPath="/tmp/jean"
          defaultBranch="main"
        />
      </SidebarWidthProvider>
    )

    expect(screen.getByText('Auth Refactor')).toBeInTheDocument()
    expect(screen.queryByTestId('linked-issue-badge')).toBeNull()
  })
})

// Regression: the session row carried no right padding at all, so the "time
// ago" text sat flush against the sidebar edge and the scrollbar thumb was
// drawn over it. The row now keeps the same `pr-2` as the workspace row.
describe('WorktreeItem session row right padding', () => {
  beforeEach(() => {
    mocks.sessions = [session('a', 'Auth Refactor')]
    useProjectsStore.setState({
      selectedWorktreeId: null,
      expandedWorktreeIds: new Set(['wt-1']),
    })
  })

  it('leaves room after the timestamp for the scrollbar', () => {
    renderItem({})

    const row = screen.getByText('Auth Refactor').closest('[class*="pl-5"]')
    expect(row).not.toBeNull()
    expect((row as HTMLElement).className).toContain('pr-2')
  })
})
