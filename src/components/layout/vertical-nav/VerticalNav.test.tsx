import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { Agent } from '@/types/agents'
import { VerticalNav } from './VerticalNav'
import type * as SidebarTabsModule from '@/components/projects/SidebarTabs'

const mocks = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  agents: [] as Partial<Agent>[],
  schedules: [] as { id: string; enabled?: boolean }[],
  archivedCount: 0,
}))

vi.mock('@/components/projects/SidebarTabs', async importOriginal => ({
  ...(await importOriginal<typeof SidebarTabsModule>()),
  useSidebarTabCounts: () => mocks.counts,
}))
vi.mock('@/services/agents', () => ({
  useAgents: () => ({ data: mocks.agents }),
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
    useUIStore.setState({
      sidebarTab: 'projects',
      verticalNavCollapsed: false,
      leftSidebarVisible: true,
      archivedViewOpen: false,
      archivedViewProjectId: null,
      scheduledViewOpen: false,
    })
    useChatStore.setState({ sendingSessionIds: {} })
  })

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
    // No count, no number.
    expect(screen.queryByTestId('vertical-nav-count-agents')).toBeNull()
  })

  it('collapses to icons with badges, To-Do blue, and persists the choice in the store', async () => {
    mocks.counts = { starred: 3, todo: 2, graphs: 5 }
    mocks.agents = [
      { id: 'a1', sessionId: 's1' },
      { id: 'a2', sessionId: 's2' },
      { id: 'a3', sessionId: null },
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
    expect(item('agents')).toHaveAccessibleName('Agents, 1 running')
    expect(item('todo')).toHaveAccessibleName('To-Do, 2 waiting for you')
    expect(item('graphs')).toHaveAccessibleName('Graphs, 5 requests')

    expect(screen.getByTestId('vertical-nav-badge-todo')).toHaveClass(
      'bg-blue-600'
    )
    expect(screen.getByTestId('vertical-nav-badge-graphs')).toHaveClass(
      'bg-zinc-500'
    )
    expect(screen.getByTestId('vertical-nav-badge-agents')).toHaveTextContent(
      '1'
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
})
