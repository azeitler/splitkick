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
}))

vi.mock('@/components/projects/SidebarTabs', async importOriginal => ({
  ...(await importOriginal<typeof SidebarTabsModule>()),
  useSidebarTabCounts: () => mocks.counts,
}))
vi.mock('@/services/agents', () => ({
  useAgents: () => ({ data: mocks.agents }),
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
    useUIStore.setState({ sidebarTab: 'projects', verticalNavCollapsed: false })
    useChatStore.setState({ sendingSessionIds: {} })
  })

  it('shows Home, then Projects, Recent, Starred, Agents, To-Do, Graphs, then Collapse', () => {
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
      'Agents',
      'To-Do',
      'Graphs',
      'Collapse',
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
    expect(screen.queryByTestId('vertical-nav-badge-todo')).toBeNull()
  })
})
