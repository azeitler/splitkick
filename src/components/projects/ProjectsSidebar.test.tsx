import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { SidebarWidthProvider } from '@/components/layout/SidebarWidthContext'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { Project } from '@/types/projects'
import { ProjectsSidebar } from './ProjectsSidebar'

const mocks = vi.hoisted(() => ({
  projects: [] as Project[],
  createFolder: vi.fn(),
}))

vi.mock('@/services/projects', () => ({
  useProjects: () => ({
    data: mocks.projects,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateFolder: () => ({ mutate: mocks.createFolder }),
}))

vi.mock('@/hooks/useInstalledBackends', () => ({
  useInstalledBackends: () => ({
    installedBackends: ['claude'],
    isUnknown: false,
  }),
}))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))

// The children have their own tests; here only their place matters.
vi.mock('./ProjectTree', () => ({
  ProjectTree: () => <div data-testid="project-tree" />,
}))
vi.mock('./SidebarStarredSection', () => ({
  SidebarStarredSection: () => <div data-testid="sidebar-starred-section" />,
}))
vi.mock('./SidebarTodoSection', () => ({
  SidebarTodoSection: () => <div data-testid="sidebar-todo-section" />,
}))
vi.mock('./SidebarGraphsSection', () => ({
  SidebarGraphsSection: () => <div data-testid="sidebar-graphs-section" />,
}))
vi.mock('./SidebarRecentSessions', () => ({
  SidebarRecentSessions: () => <div data-testid="sidebar-recent-sessions" />,
}))

function renderSidebar() {
  return render(
    <SidebarWidthProvider value={250}>
      <ProjectsSidebar />
    </SidebarWidthProvider>
  )
}

function follows(a: HTMLElement, b: HTMLElement) {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
  )
}

describe('ProjectsSidebar layout', () => {
  beforeEach(() => {
    mocks.projects = []
    mocks.createFolder.mockClear()
    useUIStore.setState({ sidebarTab: 'projects', archivedViewOpen: false })
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
  })

  it('puts Home first, then the tabs, the tree and Archived', () => {
    renderSidebar()

    const order = [
      'sidebar-home-row',
      'sidebar-tabs',
      'project-tree',
      'sidebar-archived-row',
    ].map(id => screen.getByTestId(id))

    for (let i = 1; i < order.length; i++) {
      expect(
        follows(order[i - 1] as HTMLElement, order[i] as HTMLElement)
      ).toBe(true)
    }
    // Home is outside every tab panel, so it shows whatever tab is open.
    expect(
      screen.getByTestId('sidebar-home-row').closest('[role="tabpanel"]')
    ).toBeNull()
  })

  it('no longer pins Starred, To-Do or Graphs in the Projects tab', () => {
    renderSidebar()

    expect(screen.queryByTestId('sidebar-pinned-sections')).toBeNull()
    expect(screen.queryByTestId('sidebar-starred-section')).toBeNull()
    expect(screen.queryByTestId('sidebar-todo-section')).toBeNull()
    expect(screen.queryByTestId('sidebar-graphs-section')).toBeNull()
    const scroll = screen.getByTestId('sidebar-projects-scroll')
    expect(scroll).toContainElement(screen.getByTestId('project-tree'))
    expect(scroll).toContainElement(screen.getByTestId('sidebar-archived-row'))
  })

  it.each([
    ['recent', 'sidebar-recent-sessions'],
    ['starred', 'sidebar-starred-section'],
    ['todo', 'sidebar-todo-section'],
    ['graphs', 'sidebar-graphs-section'],
  ] as const)(
    'shows the %s tab in its own panel and keeps the tree mounted',
    (tab, testId) => {
      useUIStore.setState({ sidebarTab: tab })
      renderSidebar()

      const panel = screen.getByTestId(testId).closest('[role="tabpanel"]')
      expect(panel).toHaveAttribute('id', `sidebar-panel-${tab}`)
      expect(panel).toHaveAttribute('aria-labelledby', `sidebar-tab-${tab}`)
      expect(screen.getByTestId('project-tree')).toBeInTheDocument()
      expect(
        screen.getByTestId('project-tree').closest('[role="tabpanel"]')
      ).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByTestId('sidebar-home-row')).toBeVisible()
    }
  )

  it('renders the tree even with no projects, so its New buttons stay reachable', () => {
    renderSidebar()
    expect(screen.getByTestId('project-tree')).toBeInTheDocument()
  })

  it('has no footer New or Archived buttons', () => {
    renderSidebar()

    expect(
      screen.queryByRole('button', { name: /^New$/ })
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Archived/ })).toHaveLength(1)
  })

  it('opens the Archived view from its row', async () => {
    renderSidebar()

    await userEvent.click(screen.getByTestId('sidebar-archived-row'))

    expect(useUIStore.getState().archivedViewOpen).toBe(true)
    expect(screen.getByTestId('sidebar-archived-row')).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByTestId('sidebar-home-row')).not.toHaveAttribute(
      'aria-current'
    )
  })
})
