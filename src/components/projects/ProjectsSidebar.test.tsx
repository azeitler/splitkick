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

// The children have their own tests; here only their place matters.
vi.mock('./ProjectTree', () => ({
  ProjectTree: ({ projects }: { projects: Project[] }) => (
    <div data-testid="project-tree">{projects.map(p => p.name).join(',')}</div>
  ),
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

describe('ProjectsSidebar', () => {
  beforeEach(() => {
    mocks.projects = [{ id: 'p1', name: 'acme' } as Project]
    mocks.createFolder.mockClear()
    useUIStore.setState({ sidebarTab: 'projects', archivedViewOpen: false })
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
  })

  it('shows only the panel: no Home row, tab strip, Scheduled or Archived', () => {
    renderSidebar()

    expect(screen.getByTestId('project-tree')).toBeInTheDocument()
    for (const id of [
      'sidebar-home-row',
      'sidebar-tabs',
      'sidebar-scheduled-row',
      'sidebar-archived-row',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('region', { name: 'Projects' })).toContainElement(
      screen.getByTestId('project-tree')
    )
  })

  it.each([
    ['recent', 'sidebar-recent-sessions', 'Recent'],
    ['starred', 'sidebar-starred-section', 'Starred'],
    ['todo', 'sidebar-todo-section', 'To-Do'],
    ['graphs', 'sidebar-graphs-section', 'Graphs'],
  ] as const)(
    'shows the %s tab in its own panel and keeps the tree mounted',
    (tab, testId, label) => {
      useUIStore.setState({ sidebarTab: tab })
      renderSidebar()

      const panel = screen.getByTestId(testId).closest('[role="region"]')
      expect(panel).toHaveAttribute('id', `sidebar-panel-${tab}`)
      expect(panel).toHaveAttribute('aria-label', label)
      expect(
        screen.getByTestId('project-tree').closest('#sidebar-panel-projects')
      ).toHaveAttribute('aria-hidden', 'true')
    }
  )

  it('leaves the home of a global agent out of the tree', () => {
    mocks.projects = [
      { id: 'p1', name: 'splitkick' } as Project,
      { id: 'p2', name: 'assistant', hidden: true, is_git: false } as Project,
    ]
    renderSidebar()
    expect(screen.getByTestId('project-tree')).toHaveTextContent('splitkick')
    expect(screen.getByTestId('project-tree')).not.toHaveTextContent(
      'assistant'
    )
  })

  it('shows an empty state instead of the tree with no projects', () => {
    mocks.projects = []
    renderSidebar()
    expect(screen.queryByTestId('project-tree')).toBeNull()
    expect(screen.getByTestId('projects-tree-empty')).toHaveTextContent(
      'No projects yet'
    )
    // The toolbar with its New menu stays.
    expect(
      screen.getByRole('button', { name: 'New project or folder' })
    ).toBeInTheDocument()
  })

  it('creates a folder from the toolbar menu above the scroller', async () => {
    const user = userEvent.setup()
    renderSidebar()

    // Above the scroller, so it never scrolls away with the tree.
    expect(
      screen
        .getByTestId('sidebar-projects-scroll')
        .contains(screen.getByTestId('projects-panel-toolbar'))
    ).toBe(false)

    await user.click(
      screen.getByRole('button', { name: 'New project or folder' })
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'New folder' })
    )
    expect(mocks.createFolder).toHaveBeenCalledWith({ name: 'New Folder' })
  })
})
