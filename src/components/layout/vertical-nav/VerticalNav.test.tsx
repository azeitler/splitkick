import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { Agent } from '@/types/agents'
import type { Session } from '@/types/chat'
import { VerticalNav, formatBadgeCount } from './VerticalNav'
import type * as SidebarTabsModule from '@/components/projects/SidebarTabs'

const mocks = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  agents: [] as Partial<Agent>[],
  schedules: [] as { id: string; enabled?: boolean }[],
  archivedCount: 0,
  sessions: [] as Partial<Session>[],
  graphs: [] as { id: string; openRequests: number }[],
}))

vi.mock('@/components/projects/SidebarTabs', async importOriginal => ({
  ...(await importOriginal<typeof SidebarTabsModule>()),
  useSidebarTabCounts: () => mocks.counts,
}))
vi.mock('@/services/agents', () => ({
  useAgents: () => ({ data: mocks.agents }),
}))
vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({
    data: {
      entries: [
        {
          project_id: 'p1',
          project_name: 'Acme',
          worktree_id: 'w1',
          worktree_name: 'main',
          worktree_path: '/tmp/w1',
          sessions: mocks.sessions,
        },
      ],
    },
  }),
}))
vi.mock('@/services/graphs', () => ({
  useGraphs: () => ({ data: mocks.graphs }),
}))
vi.mock('@/services/schedules', () => ({
  useSchedules: () => ({ data: mocks.schedules }),
}))
vi.mock('@/components/archive/useArchivedCount', () => ({
  useArchivedCount: () => mocks.archivedCount,
}))

function renderNav(home = false) {
  const onSelectHome = vi.fn()
  const onSelectTab = vi.fn()
  render(
    <VerticalNav
      home={home}
      onSelectHome={onSelectHome}
      onSelectTab={onSelectTab}
    />
  )
  return { onSelectHome, onSelectTab }
}

const item = (id: string) => screen.getByTestId(`vertical-nav-${id}`)

describe('VerticalNav', () => {
  beforeEach(() => {
    mocks.counts = {}
    mocks.agents = []
    mocks.schedules = []
    mocks.archivedCount = 0
    mocks.sessions = []
    mocks.graphs = []
    useUIStore.setState({
      sidebarTab: 'projects',
      verticalNavCollapsed: false,
      leftSidebarVisible: true,
      archivedViewOpen: false,
      archivedViewProjectId: null,
      scheduledViewOpen: false,
    })
    useChatStore.setState({
      sendingSessionIds: {},
      waitingForInputSessionIds: {},
    })
  })

  function agentSession(id: string, extra: Partial<Session> = {}) {
    return {
      id,
      name: id,
      order: 0,
      created_at: 1,
      updated_at: 1,
      messages: [],
      ...extra,
    } as Partial<Session>
  }

  it('shows Home, the tabs, Scheduled and Archived, then Collapse', () => {
    renderNav()
    const nav = screen.getByRole('navigation', { name: 'Sidebar navigation' })
    const labels = within(nav)
      .getAllByRole('button')
      .map(button => button.textContent)
    expect(labels).toEqual([
      'Home',
      'Projects',
      'Recent',
      'Starred',
      'To-Do',
      'Agents',
      'Graphs',
      'Scheduled',
      'Archived',
      'Collapse',
    ])
  })

  it('gives Projects an open-folder icon', () => {
    renderNav()
    const icon = item('projects').querySelector('svg')
    expect(icon).toHaveClass('lucide-folder-open')
  })

  it('puts a divider after Home, after To-Do and after Graphs', () => {
    renderNav()
    const nav = screen.getByRole('navigation', { name: 'Sidebar navigation' })
    // Buttons by test id, dividers as '|'; the spacer above Collapse drops.
    const sequence = Array.from(nav.children).map(el =>
      el.tagName === 'BUTTON'
        ? (el.getAttribute('data-testid') ?? '')
        : el.getAttribute('aria-hidden') === 'true'
          ? '|'
          : ''
    )
    expect(sequence.filter(entry => entry !== '')).toEqual([
      'vertical-nav-home',
      '|',
      'vertical-nav-projects',
      'vertical-nav-recent',
      'vertical-nav-starred',
      'vertical-nav-todo',
      '|',
      'vertical-nav-agents',
      'vertical-nav-graphs',
      '|',
      'vertical-nav-scheduled',
      'vertical-nav-archived',
      'vertical-nav-collapse',
    ])
  })

  it('marks the selected tab, or Home on Home', () => {
    const { unmount } = render(
      <VerticalNav home={false} onSelectHome={vi.fn()} onSelectTab={vi.fn()} />
    )
    expect(item('projects')).toHaveAttribute('aria-current', 'page')
    expect(item('home')).not.toHaveAttribute('aria-current')
    unmount()

    renderNav(true)
    expect(item('home')).toHaveAttribute('aria-current', 'page')
    expect(item('projects')).not.toHaveAttribute('aria-current')
  })

  it('reports clicks on Home and on a tab', async () => {
    const { onSelectHome, onSelectTab } = renderNav()
    await userEvent.click(item('todo'))
    expect(onSelectTab).toHaveBeenCalledWith('todo')
    await userEvent.click(item('home'))
    expect(onSelectHome).toHaveBeenCalled()
  })

  it('shows the counts at the end of the row when expanded, no badges', () => {
    mocks.counts = { starred: 3, todo: 2, graphs: 5 }
    renderNav()
    expect(screen.getByTestId('vertical-nav-count-starred')).toHaveTextContent(
      '3'
    )
    expect(screen.getByTestId('vertical-nav-count-todo')).toHaveClass(
      'text-blue-600'
    )
    expect(screen.queryByTestId('vertical-nav-badge-starred')).toBeNull()
    // No agents and no graphs: no number.
    expect(screen.queryByTestId('vertical-nav-count-agents')).toBeNull()
    expect(screen.queryByTestId('vertical-nav-count-graphs')).toBeNull()
  })

  it('collapses to icons with badges, To-Do blue, and persists the choice in the store', async () => {
    mocks.counts = { starred: 3, todo: 2, graphs: 5 }
    mocks.agents = [
      { id: 'a1', sessionId: 's1' },
      { id: 'a2', sessionId: 's2' },
      { id: 'a3', sessionId: null },
    ]
    mocks.sessions = [agentSession('s1'), agentSession('s2')]
    mocks.graphs = [
      { id: 'g1', openRequests: 5 },
      { id: 'g2', openRequests: 0 },
    ]
    useChatStore.setState({ sendingSessionIds: { s1: true } })
    renderNav()

    await userEvent.click(item('collapse'))
    expect(useUIStore.getState().verticalNavCollapsed).toBe(true)
    expect(screen.getByTestId('vertical-nav')).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    expect(screen.getByTestId('vertical-nav')).toHaveStyle({ width: '46px' })
    // Collapsed rows centre the icon with no side padding: 34 px (9 + 16 + 9)
    // would not fit the 33 px inside the nav.
    for (const id of ['home', 'starred', 'collapse']) {
      expect(item(id)).toHaveClass('justify-center', 'px-0')
      expect(item(id)).not.toHaveClass('px-[9px]')
      // Not clipped: the badge may reach past the row.
      expect(item(id)).not.toHaveClass('overflow-hidden')
    }
    // Icons only: the labels are gone, the names stay for assistive tech.
    expect(item('starred')).toHaveTextContent('3')
    expect(item('starred')).not.toHaveTextContent('Starred')
    expect(item('starred')).toHaveAccessibleName('Starred, 3')
    expect(item('agents')).toHaveAccessibleName('Agents, 3 agents, 1 running')
    expect(item('todo')).toHaveAccessibleName('To-Do, 2 waiting for you')
    expect(item('graphs')).toHaveAccessibleName(
      'Graphs, 2 graphs, 5 open requests'
    )

    expect(screen.getByTestId('vertical-nav-badge-todo')).toHaveClass(
      'bg-blue-600'
    )
    // Open requests need the user: blue. The badge counts the graphs.
    expect(screen.getByTestId('vertical-nav-badge-graphs')).toHaveClass(
      'bg-blue-600'
    )
    expect(screen.getByTestId('vertical-nav-badge-graphs')).toHaveTextContent(
      '2'
    )
    // All agents count; none waits, so grey.
    expect(screen.getByTestId('vertical-nav-badge-agents')).toHaveTextContent(
      '3'
    )
    expect(screen.getByTestId('vertical-nav-badge-agents')).toHaveClass(
      'bg-zinc-500'
    )
    // Digits centred by flex, not by line height.
    expect(screen.getByTestId('vertical-nav-badge-todo')).toHaveClass(
      'inline-flex',
      'items-center',
      'justify-center'
    )
    // No width animation on collapse/expand (it lagged).
    expect(screen.getByTestId('vertical-nav').className).not.toMatch(
      /transition-\[width\]/
    )
    expect(item('collapse')).toHaveAccessibleName('Expand')

    await userEvent.click(item('collapse'))
    expect(useUIStore.getState().verticalNavCollapsed).toBe(false)
    expect(screen.getByTestId('vertical-nav')).toHaveStyle({ width: '168px' })
    expect(item('starred')).toHaveClass('px-[9px]')
    expect(item('starred')).toHaveTextContent('Starred')
    expect(screen.queryByTestId('vertical-nav-badge-todo')).toBeNull()
  })

  it('opens the Scheduled and Archived pages in the main area', async () => {
    useUIStore.setState({ leftSidebarVisible: false })
    renderNav(true)

    await userEvent.click(item('scheduled'))
    expect(useUIStore.getState().scheduledViewOpen).toBe(true)
    // The sidebar comes back, so the nav stays in view.
    expect(useUIStore.getState().leftSidebarVisible).toBe(true)
    expect(item('scheduled')).toHaveAttribute('aria-current', 'page')

    useUIStore.setState({ archivedViewProjectId: 'p1' })
    await userEvent.click(item('archived'))
    const ui = useUIStore.getState()
    expect(ui.archivedViewOpen).toBe(true)
    expect(ui.scheduledViewOpen).toBe(false)
    // The nav item shows every project.
    expect(ui.archivedViewProjectId).toBeNull()
    expect(item('archived')).toHaveAttribute('aria-current', 'page')
    expect(item('scheduled')).not.toHaveAttribute('aria-current')
  })

  it('counts active schedules and archived items', async () => {
    mocks.schedules = [
      { id: 's1', enabled: true },
      { id: 's2', enabled: false },
      { id: 's3' },
    ]
    mocks.archivedCount = 7
    renderNav()
    expect(
      screen.getByTestId('vertical-nav-count-scheduled')
    ).toHaveTextContent('2')
    expect(screen.getByTestId('vertical-nav-count-archived')).toHaveTextContent(
      '7'
    )

    await userEvent.click(item('collapse'))
    expect(item('scheduled')).toHaveAccessibleName('Scheduled, 2 active')
    expect(item('archived')).toHaveAccessibleName('Archived, 7 archived')
    expect(screen.getByTestId('vertical-nav-badge-archived')).toHaveTextContent(
      '7'
    )
  })

  it('shows no count on Scheduled and Archived when there is nothing', () => {
    renderNav()
    expect(screen.queryByTestId('vertical-nav-count-scheduled')).toBeNull()
    expect(screen.queryByTestId('vertical-nav-count-archived')).toBeNull()
  })

  describe('agents count', () => {
    beforeEach(() => {
      mocks.agents = [
        { id: 'a1', sessionId: 's1' },
        { id: 'a2', sessionId: 's2' },
        { id: 'a3', sessionId: 's3' },
      ]
    })

    it('counts a run this window did not start (detached or resumed)', () => {
      mocks.sessions = [
        agentSession('s1', {
          last_run_status: 'running',
          last_run_execution_mode: 'yolo',
        }),
        agentSession('s2', { last_run_status: 'completed' }),
        agentSession('s3'),
      ]
      renderNav()
      expect(item('agents')).toHaveAccessibleName('Agents, 3 agents, 1 running')
      expect(screen.getByTestId('vertical-nav-count-agents')).not.toHaveClass(
        'text-blue-600'
      )
    })

    it('turns blue and says so when an agent waits for input', () => {
      mocks.sessions = [
        agentSession('s1', {
          last_run_status: 'running',
          last_run_execution_mode: 'build',
        }),
        agentSession('s2', {
          last_run_status: 'running',
          waiting_for_input: true,
          waiting_for_input_type: 'question',
        }),
        agentSession('s3'),
      ]
      renderNav()
      expect(item('agents')).toHaveAccessibleName(
        'Agents, 3 agents, 1 running, 1 waiting for you'
      )
      expect(screen.getByTestId('vertical-nav-count-agents')).toHaveTextContent(
        '3'
      )
      expect(screen.getByTestId('vertical-nav-count-agents')).toHaveClass(
        'text-blue-600'
      )
    })

    it('shows the number of agents when none runs or waits', () => {
      mocks.sessions = [
        agentSession('s1', { last_run_status: 'completed' }),
        agentSession('s2'),
        agentSession('s3', { last_run_status: 'cancelled' }),
      ]
      renderNav()
      expect(screen.getByTestId('vertical-nav-count-agents')).toHaveTextContent(
        '3'
      )
      expect(item('agents')).toHaveAccessibleName('Agents, 3 agents')
    })

    it('shows no count without agents', () => {
      mocks.agents = []
      renderNav()
      expect(screen.queryByTestId('vertical-nav-count-agents')).toBeNull()
      expect(item('agents')).toHaveAccessibleName('Agents')
    })

    it('leaves out an archived session', () => {
      mocks.sessions = [
        agentSession('s1', {
          last_run_status: 'running',
          archived_at: 5,
        }),
      ]
      renderNav()
      expect(item('agents')).toHaveAccessibleName('Agents, 3 agents')
    })
  })
})

describe('formatBadgeCount', () => {
  it('shows up to two digits and 99+ above', () => {
    expect(formatBadgeCount(7)).toBe('7')
    expect(formatBadgeCount(99)).toBe('99')
    expect(formatBadgeCount(100)).toBe('99+')
    expect(formatBadgeCount(1234)).toBe('99+')
  })
})
