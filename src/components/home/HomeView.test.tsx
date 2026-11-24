import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import { HomeView } from './HomeView'
import { ToolbarSlotsProvider } from '@/components/toolbar/toolbar-slots'
import { WindowToolbar } from '@/components/toolbar/WindowToolbar'
import { useProjectsStore } from '@/store/projects-store'
import type { AllSessionsResponse, LabelData, Session } from '@/types/chat'
import type { ActivityEvent } from '@/types/activity'
import type { Project } from '@/types/projects'

const bug: LabelData = { name: 'Bug', color: '#ef4444' }

const mocks = vi.hoisted(() => ({
  sessions: { entries: [] } as AllSessionsResponse,
  // undefined = never loaded, as TanStack Query reports a first-load failure.
  activity: [] as ActivityEvent[] | undefined,
  activityError: false,
  refetchActivity: vi.fn(),
  navigateToSession: vi.fn(),
  navigateToProject: vi.fn(),
}))

vi.mock('@/services/chat', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/chat')>()),
  useAllSessions: () => ({ data: mocks.sessions, isLoading: false }),
}))

vi.mock('@/services/activity', () => ({
  useRecentActivity: () => ({
    data: mocks.activity,
    isLoading: false,
    isError: mocks.activityError,
    refetch: mocks.refetchActivity,
  }),
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

function renderHome(homeProjects: Project[] = projects) {
  return render(
    <HomeView
      projects={homeProjects}
      onProjectClick={vi.fn()}
      onAddProject={vi.fn()}
    />
  )
}

/** The activity feed is closed until its heading is clicked. */
async function openActivity() {
  await userEvent.click(screen.getByRole('button', { name: 'Recent activity' }))
}

/** `count` sessions in `jean / main`, then two in a second project. */
function manySessions(count: number): AllSessionsResponse {
  return {
    entries: [
      {
        project_id: 'p1',
        project_name: 'jean',
        worktree_id: 'w1',
        worktree_name: 'main',
        worktree_path: '/tmp/w1',
        sessions: Array.from({ length: count }, (_, i) =>
          session(`s${i}`, `session ${i}`, { updated_at: 1000 - i })
        ),
      },
      {
        project_id: 'p2',
        project_name: 'paperwork',
        worktree_id: 'w2',
        worktree_name: 'main',
        worktree_path: '/tmp/w2',
        sessions: [
          session('pw1', 'invoice run', { updated_at: 10 }),
          session('pw2', 'tax export', { updated_at: 5 }),
        ],
      },
    ],
  }
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activityError = false
    mocks.activity = []
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
  })

  it('puts its heading in the window toolbar on desktop', () => {
    render(
      <ToolbarSlotsProvider>
        <WindowToolbar fallbackTitle="Jean" />
        <HomeView
          projects={projects}
          onProjectClick={vi.fn()}
          onAddProject={vi.fn()}
        />
      </ToolbarSlotsProvider>
    )
    const toolbar = screen.getByTestId('window-toolbar')
    expect(toolbar).toHaveTextContent('Home')
    expect(toolbar).toHaveTextContent('The sessions you touched last')
    expect(within(toolbar).getByTestId('toolbar-search-palette')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull()
  })

  it('keeps the activity feed closed until its heading is clicked', async () => {
    renderHome()

    const toggle = screen.getByRole('button', { name: 'Recent activity' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('PR merged')).toBeNull()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('PR merged')).toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.queryByText('PR merged')).toBeNull()
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
    await openActivity()

    await userEvent.click(screen.getByText('Session finished'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's-new',
    })
  })

  it('falls back to the project when a record has no session', async () => {
    renderHome()
    await openActivity()

    await userEvent.click(screen.getByText('PR merged'))
    expect(mocks.navigateToProject).toHaveBeenCalledWith('p1')
    expect(mocks.navigateToSession).not.toHaveBeenCalled()
  })

  it('shows an empty state when nothing has happened yet', async () => {
    mocks.activity = []
    renderHome()
    await openActivity()

    expect(
      screen.getByText(/Finished sessions, commits, pull requests, and reviews/)
    ).toBeInTheDocument()
  })

  it('lays sessions and projects out as two columns', () => {
    renderHome()

    const sessionsColumn = screen.getByTestId('home-column-sessions')
    const projectsColumn = screen.getByTestId('home-column-projects')

    // The closed activity feed shares the sessions column, under the sessions.
    const headings = within(sessionsColumn)
      .getAllByRole('heading')
      .map(heading => heading.textContent)
    expect(headings).toEqual(['Recent sessions', 'Recent activity'])
    expect(screen.queryByTestId('home-column-activity')).toBeNull()
    expect(
      within(projectsColumn).getByRole('heading', { name: 'Projects' })
    ).toBeInTheDocument()

    // Siblings of one grid, in reading order.
    expect(sessionsColumn.nextElementSibling).toBe(projectsColumn)
  })

  it('reports a failed activity load instead of claiming nothing happened', async () => {
    mocks.activityError = true
    mocks.activity = undefined
    renderHome()
    await openActivity()

    expect(screen.getByText(/Could not load activity/)).toBeInTheDocument()
    expect(
      screen.queryByText(/Finished sessions, commits, pull requests/)
    ).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.refetchActivity).toHaveBeenCalled()
  })

  it('keeps the loaded feed when a later refresh fails', async () => {
    // A refetch after `activity:appended` failed; TanStack keeps the old data.
    mocks.activityError = true
    mocks.activity = [
      {
        id: 'e1',
        kind: 'commit_created',
        at: 100,
        projectName: 'jean',
        title: 'fix: keep the feed',
      },
    ]
    renderHome()
    await openActivity()

    expect(screen.getByText('fix: keep the feed')).toBeInTheDocument()
    expect(screen.queryByText(/Could not load activity/)).toBeNull()
  })

  it('lists every session at once, with no show-more step', () => {
    mocks.sessions = manySessions(30)
    renderHome()

    // Plain DOM queries: *ByRole over 32 rows takes over a second, and
    // under load more than the test timeout.
    const list = screen.getByTestId('home-recent-sessions')
    expect(list.querySelectorAll('li')).toHaveLength(32)
    const showMore = [...document.querySelectorAll('button')].filter(button =>
      /^Show /.test(
        button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''
      )
    )
    expect(showMore).toEqual([])
  })

  it('shows the session filter only once the list is long enough', () => {
    renderHome()
    // The default fixture holds two sessions.
    expect(screen.queryByPlaceholderText('Filter sessions...')).toBeNull()
  })

  it('filters recent sessions by name', async () => {
    mocks.sessions = manySessions(6)
    renderHome()

    await userEvent.type(
      screen.getByPlaceholderText('Filter sessions...'),
      'invoice'
    )

    const list = screen.getByTestId('home-recent-sessions')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('invoice run')).toBeInTheDocument()
  })

  it('narrows to one project when its name is typed', async () => {
    mocks.sessions = manySessions(6)
    renderHome()

    await userEvent.type(
      screen.getByPlaceholderText('Filter sessions...'),
      'paperwork'
    )

    const list = screen.getByTestId('home-recent-sessions')
    expect(
      within(list)
        .getAllByRole('listitem')
        .map(
          item => within(item).getByText(/invoice run|tax export/).textContent
        )
    ).toEqual(['invoice run', 'tax export'])
  })

  it('says so when no session matches the filter', async () => {
    mocks.sessions = manySessions(6)
    renderHome()

    await userEvent.type(
      screen.getByPlaceholderText('Filter sessions...'),
      'nothing like this'
    )

    expect(screen.queryByTestId('home-recent-sessions')).toBeNull()
    expect(
      screen.getByText(/No sessions match .nothing like this./)
    ).toBeInTheDocument()
  })

  describe('layout', () => {
    it('steps from one to two to three columns by its own width', () => {
      renderHome()
      const view = screen.getByTestId('home-view')
      const grid = screen.getByTestId('home-grid')

      // Container queries: the view's width decides, not the window's.
      expect(view).toHaveClass('@container')
      // Narrow: one column (no template), the page scrolls.
      expect(grid).toHaveClass('grid')
      expect(grid.className).not.toMatch(/(^| )grid-cols-/)
      // `@3xl`: sessions beside projects.
      expect(grid).toHaveClass(
        '@3xl:grid-cols-[minmax(0,1.6fr)_minmax(16rem,1fr)]'
      )
      // `@6xl`: one equal column per part; an empty part takes none.
      expect(grid).toHaveClass(
        '@6xl:grid-cols-none',
        '@6xl:grid-flow-col',
        '@6xl:auto-cols-[minmax(0,1fr)]'
      )
      expect(screen.getByTestId('home-column-sessions')).toHaveClass(
        '@6xl:contents'
      )
      expect(screen.getByTestId('home-column-needs-you')).toHaveClass(
        'empty:hidden'
      )
    })

    it('puts To-Do and Starred apart from Recent sessions and activity', () => {
      mocks.sessions = {
        entries: [
          {
            project_id: 'p1',
            project_name: 'jean',
            worktree_id: 'w1',
            worktree_name: 'main',
            worktree_path: '/tmp/w1',
            sessions: [session('t1', 'to do', { todo_at: 5 })],
          },
        ],
      }
      renderHome()

      const headings = (testId: string) =>
        within(screen.getByTestId(testId))
          .getAllByRole('heading')
          .map(heading => heading.textContent)
      expect(headings('home-column-needs-you')).toEqual(['To-Do (1)'])
      expect(headings('home-column-recent')).toEqual([
        'Recent sessions',
        'Recent activity',
      ])
    })

    it('leaves the To-Do and Starred column empty when nothing needs you', () => {
      renderHome()
      expect(screen.getByTestId('home-column-needs-you')).toBeEmptyDOMElement()
    })

    it('pads every scroll area on the right, clear of the scroll bar', () => {
      renderHome()
      expect(screen.getByTestId('home-column-sessions')).toHaveClass(
        '@3xl:pr-3',
        '@3xl:[scrollbar-gutter:stable]'
      )
      expect(screen.getByTestId('home-column-recent')).toHaveClass(
        '@6xl:pr-3',
        '@6xl:[scrollbar-gutter:stable]'
      )
      // The last column holds the view's right padding.
      expect(screen.getByTestId('home-column-projects')).toHaveClass(
        '@3xl:pr-6'
      )
    })
  })

  describe('projects by folder', () => {
    const folder = (id: string, name: string, order: number) =>
      ({ id, name, order, is_folder: true }) as unknown as Project
    const project = (
      id: string,
      name: string,
      order: number,
      parent_id?: string
    ) => ({ id, name, order, parent_id }) as unknown as Project
    const tree = [
      folder('f-clients', 'Clients', 0),
      folder('f-internal', 'Internal', 1),
      project('acme', 'Acme Web', 0, 'f-clients'),
      project('tools', 'Tools', 0, 'f-internal'),
      project('mobile', 'Mobile app', 2),
    ]

    const groupNames = () =>
      [
        ...screen
          .getByTestId('home-projects')
          .querySelectorAll('[data-testid^="home-project-group-"]'),
      ].map(group => [
        group.getAttribute('data-testid'),
        [...group.querySelectorAll('button[title]')].map(b =>
          b.getAttribute('title')
        ),
      ])

    it('groups the cards under their folders, loose projects last', () => {
      renderHome(tree)
      expect(groupNames()).toEqual([
        ['home-project-group-f-clients', ['Acme Web']],
        ['home-project-group-f-internal', ['Tools']],
        ['home-project-group-root', ['Mobile app']],
      ])
      expect(
        screen.getByRole('button', { name: /Not in a folder/ })
      ).toBeInTheDocument()
    })

    it('shows no folder headers when there are no folders', () => {
      renderHome([project('a', 'Acme Web', 0), project('b', 'Tools', 1)])
      expect(
        screen.queryByRole('button', { name: /Not in a folder/ })
      ).toBeNull()
      expect(screen.getByTitle('Acme Web')).toBeInTheDocument()
    })

    it('collapses a folder from its header', async () => {
      renderHome(tree)
      const header = screen.getByRole('button', { name: /Clients/ })
      expect(header).toHaveAttribute('aria-expanded', 'true')

      await userEvent.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByTitle('Acme Web')).toBeNull()
      expect(screen.getByTitle('Tools')).toBeInTheDocument()
    })

    it('filters across folders and drops groups with no match', async () => {
      const many = [
        ...tree,
        project('c', 'Docs site', 3),
        project('d', 'Design system', 4),
        project('e', 'Playground', 5),
      ]
      renderHome(many)
      await userEvent.click(screen.getByRole('button', { name: /Clients/ }))

      await userEvent.type(
        screen.getByPlaceholderText('Filter projects...'),
        'acme'
      )
      // A filter shows a match in a collapsed folder too.
      expect(groupNames()).toEqual([
        ['home-project-group-f-clients', ['Acme Web']],
      ])
    })
  })
})
