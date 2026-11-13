import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { SidebarWidthProvider } from '@/components/layout/SidebarWidthContext'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { AllSessionsEntry, Session } from '@/types/chat'
import type { GraphSummary } from '@/types/graphs'
import { isSidebarTab } from '@/types/ui-state'
import { SidebarTabs } from './SidebarTabs'

const mocks = vi.hoisted(() => ({
  entries: [] as AllSessionsEntry[],
  graphs: [] as Partial<GraphSummary>[],
}))

vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({ data: { entries: mocks.entries } }),
}))
vi.mock('@/services/graphs', () => ({
  useGraphs: () => ({ data: mocks.graphs }),
}))

function renderTabs(width = 250) {
  return render(
    <SidebarWidthProvider value={width}>
      <SidebarTabs />
    </SidebarWidthProvider>
  )
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })

describe('SidebarTabs', () => {
  beforeEach(() => {
    mocks.entries = []
    mocks.graphs = []
    useUIStore.setState({ sidebarTab: 'projects' })
    useProjectsStore.setState({ starredSessions: [] })
  })

  it('shows Projects, Recent, Starred, To-Do and Graphs, Projects selected', () => {
    renderTabs()
    const names = screen.getAllByRole('tab').map(t => t.getAttribute('id'))
    expect(names).toEqual([
      'sidebar-tab-projects',
      'sidebar-tab-recent',
      'sidebar-tab-starred',
      'sidebar-tab-todo',
      'sidebar-tab-graphs',
    ])
    expect(tab(/^Projects$/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/^Recent$/)).toHaveAttribute('aria-selected', 'false')
  })

  it('switches the store tab on click', async () => {
    renderTabs()
    await userEvent.click(tab(/^Starred$/))
    expect(useUIStore.getState().sidebarTab).toBe('starred')
    expect(tab(/^Starred$/)).toHaveAttribute('aria-selected', 'true')
  })

  it('moves between tabs with the arrow keys, Home and End, as a tablist', async () => {
    const user = userEvent.setup()
    renderTabs()
    // Roving tab index: only the selected tab is in the tab order.
    expect(tab(/^Projects$/)).toHaveAttribute('tabindex', '0')
    expect(tab(/^Recent$/)).toHaveAttribute('tabindex', '-1')

    tab(/^Projects$/).focus()
    await user.keyboard('{ArrowRight}')
    expect(useUIStore.getState().sidebarTab).toBe('recent')
    expect(tab(/^Recent$/)).toHaveFocus()

    await user.keyboard('{End}')
    expect(useUIStore.getState().sidebarTab).toBe('graphs')
    await user.keyboard('{ArrowRight}')
    expect(useUIStore.getState().sidebarTab).toBe('projects')
    await user.keyboard('{ArrowLeft}')
    expect(useUIStore.getState().sidebarTab).toBe('graphs')
    await user.keyboard('{Home}')
    expect(useUIStore.getState().sidebarTab).toBe('projects')
    expect(tab(/^Projects$/)).toHaveFocus()
  })

  it('shows only the selected label at the default width, the rest as icons with a tooltip', () => {
    renderTabs(250)
    expect(tab(/^Projects$/)).toHaveTextContent('Projects')
    expect(tab(/^Projects$/)).not.toHaveAttribute('title')
    expect(tab(/^Recent$/)).toHaveTextContent('')
    expect(tab(/^Recent$/)).toHaveAttribute('title', 'Recent')
  })

  it('shows every label when wide, and none when narrow', () => {
    const { unmount } = renderTabs(420)
    expect(tab(/^Recent$/)).toHaveTextContent('Recent')
    unmount()

    renderTabs(180)
    expect(tab(/^Projects$/)).toHaveTextContent('')
    expect(tab(/^Projects$/)).toHaveAttribute('title', 'Projects')
  })

  it('counts To-Do and starred sessions and graph requests', () => {
    mocks.entries = [
      {
        project_id: 'p1',
        project_name: 'Jean',
        worktree_id: 'w1',
        worktree_name: 'main',
        worktree_path: '/tmp/jean',
        sessions: [
          { id: 's1', name: 'One', todo_at: 10 },
          { id: 's2', name: 'Two', todo_at: 20 },
          { id: 's3', name: 'Three' },
        ] as Session[],
      } as AllSessionsEntry,
    ]
    mocks.graphs = [
      { id: 'g1', openRequests: 2 },
      { id: 'g2', openRequests: 1 },
    ]
    useProjectsStore.setState({
      starredSessions: [{ sessionId: 's3', projectId: 'p1', worktreeId: 'w1' }],
    })
    renderTabs()

    expect(screen.getByTestId('sidebar-tab-count-todo')).toHaveTextContent('2')
    expect(tab(/^To-Do 2$/)).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-tab-count-starred')).toHaveTextContent(
      '1'
    )
    expect(tab(/^Graphs, 3 waiting for you$/)).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-tab-count-projects')).toBeNull()
  })
})

describe('isSidebarTab', () => {
  it('accepts every tab and rejects an unknown stored value', () => {
    for (const id of ['projects', 'recent', 'starred', 'todo', 'graphs']) {
      expect(isSidebarTab(id)).toBe(true)
    }
    expect(isSidebarTab('pinned')).toBe(false)
    expect(isSidebarTab(null)).toBe(false)
  })
})
