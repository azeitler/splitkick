import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import { HomeView } from './HomeView'
import { useProjectsStore } from '@/store/projects-store'
import type { AllSessionsResponse, LabelData, Session } from '@/types/chat'
import type { ActivityEvent } from '@/types/activity'
import type { Project } from '@/types/projects'

const bug: LabelData = { name: 'Bug', color: '#ef4444' }

const mocks = vi.hoisted(() => ({
  sessions: { entries: [] } as AllSessionsResponse,
  activity: [] as ActivityEvent[],
  navigateToSession: vi.fn(),
  navigateToProject: vi.fn(),
}))

vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({ data: mocks.sessions, isLoading: false }),
}))

vi.mock('@/services/activity', () => ({
  useRecentActivity: () => ({ data: mocks.activity, isLoading: false }),
}))

vi.mock('@/services/projects', () => ({
  useAppDataDir: () => ({ data: '' }),
}))

vi.mock('@/lib/navigate-to-session', () => ({
  navigateToSession: mocks.navigateToSession,
  navigateToProject: mocks.navigateToProject,
}))

function session(id: string, name: string, extra: Partial<Session> = {}) {
  return {
    id,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...extra,
  } as unknown as Session
}

const projects: Project[] = [{ id: 'p1', name: 'jean' } as unknown as Project]

function renderHome() {
  return render(
    <HomeView
      projects={projects}
      onProjectClick={vi.fn()}
      onAddProject={vi.fn()}
    />
  )
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectsStore.setState({ starredSessions: [] })
    mocks.sessions = {
      entries: [
        {
          project_id: 'p1',
          project_name: 'jean',
          worktree_id: 'w1',
          worktree_name: 'main',
          worktree_path: '/tmp/w1',
          sessions: [
            session('s-new', 'newest', { updated_at: 300, label: bug }),
            session('s-old', 'oldest', { updated_at: 100 }),
          ],
        },
      ],
    }
    mocks.activity = [
      {
        id: 'a1',
        kind: 'pr_merged',
        at: Math.floor(Date.now() / 1000) - 60,
        projectId: 'p1',
        projectName: 'jean',
        worktreeId: 'w1',
        worktreeName: 'main',
        title: '#7',
        url: 'https://example.test/pr/7',
      },
    ]
  })

  it('lists projects, recent sessions and recent activity', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Projects' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Recent sessions' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Recent activity' })
    ).toBeInTheDocument()

    expect(screen.getByText('newest')).toBeInTheDocument()
    expect(screen.getByText('PR merged')).toBeInTheDocument()
  })

  it('shows no Starred section while nothing is starred', () => {
    renderHome()

    expect(screen.queryByRole('heading', { name: 'Starred' })).toBeNull()
  })

  // Star order, not activity order: "oldest" was starred first.
  it('lists starred sessions above recent ones, in star order', () => {
    useProjectsStore.setState({
      starredSessions: [
        { projectId: 'p1', worktreeId: 'w1', sessionId: 's-old' },
        { projectId: 'p1', worktreeId: 'w1', sessionId: 's-new' },
      ],
    })
    renderHome()

    const starred = screen.getByTestId('home-starred-sessions')
    const names = within(starred)
      .getAllByRole('button')
      .map(row => row.textContent ?? '')
    expect(names[0]).toContain('oldest')
    expect(names[1]).toContain('newest')

    const starredHeading = screen.getByRole('heading', { name: 'Starred' })
    const recentHeading = screen.getByRole('heading', {
      name: 'Recent sessions',
    })
    expect(
      starredHeading.compareDocumentPosition(recentHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('opens a starred session through the shared navigation helper', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({
      starredSessions: [
        { projectId: 'p1', worktreeId: 'w1', sessionId: 's-old' },
      ],
    })
    renderHome()

    await user.click(
      within(screen.getByTestId('home-starred-sessions')).getByText('oldest')
    )

    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's-old',
    })
  })

  it('sorts recent sessions by activity, newest first', () => {
    renderHome()

    const [firstRow] = screen.getAllByRole('listitem')
    if (!firstRow) throw new Error('expected at least one session row')
    expect(within(firstRow).getByText('newest')).toBeInTheDocument()
  })

  it('opens a session row through the shared navigation helper', async () => {
    renderHome()

    await userEvent.click(screen.getByText('newest'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's-new',
    })
  })

  it('filters recent sessions by label, and clears again', async () => {
    renderHome()

    await userEvent.click(screen.getByRole('button', { name: /Bug/ }))
    expect(screen.getByText('newest')).toBeInTheDocument()
    expect(screen.queryByText('oldest')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('oldest')).toBeInTheDocument()
  })

  it('opens the activity target session when the record names one', async () => {
    mocks.activity = [
      {
        id: 'a2',
        kind: 'session_completed',
        at: Math.floor(Date.now() / 1000),
        projectId: 'p1',
        projectName: 'jean',
        worktreeId: 'w1',
        sessionId: 's-new',
        sessionName: 'newest',
      },
    ]
    renderHome()

    await userEvent.click(screen.getByText('Session finished'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's-new',
    })
  })

  it('falls back to the project when a record has no session', async () => {
    renderHome()

    await userEvent.click(screen.getByText('PR merged'))
    expect(mocks.navigateToProject).toHaveBeenCalledWith('p1')
    expect(mocks.navigateToSession).not.toHaveBeenCalled()
  })

  it('shows an empty state when nothing has happened yet', () => {
    mocks.activity = []
    renderHome()

    expect(
      screen.getByText(/Finished sessions, commits, pull requests, and reviews/)
    ).toBeInTheDocument()
  })
})
