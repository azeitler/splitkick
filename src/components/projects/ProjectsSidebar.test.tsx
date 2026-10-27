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

  it('puts the tabs first, then Home, Starred, the tree and Archived', () => {
    renderSidebar()

    const order = [
      'sidebar-tabs',
      'sidebar-home-row',
      'sidebar-starred-section',
      'project-tree',
      'sidebar-archived-row',
    ].map(id => screen.getByTestId(id))

    for (let i = 1; i < order.length; i++) {
      expect(
        follows(order[i - 1] as HTMLElement, order[i] as HTMLElement)
      ).toBe(true)
    }
  })

  it('pins Home above the list; Starred scrolls with the tree (#45)', () => {
    renderSidebar()

    const scroll = screen.getByTestId('sidebar-projects-scroll')
    expect(scroll).not.toContainElement(screen.getByTestId('sidebar-home-row'))
    // One list, so its section headers can stack as a sticky header.
    expect(scroll).toContainElement(
      screen.getByTestId('sidebar-starred-section')
    )
    expect(scroll).toContainElement(screen.getByTestId('project-tree'))
    expect(scroll).toContainElement(screen.getByTestId('sidebar-archived-row'))
  })

  it('keeps Home in the Projects tab, so Recent shows only recent sessions', () => {
    useUIStore.setState({ sidebarTab: 'recent' })
    renderSidebar()

    const projectsPanel = screen
      .getByTestId('sidebar-home-row')
      .closest('[role="tabpanel"]')
    expect(projectsPanel).toHaveAttribute('id', 'sidebar-panel-projects')
    expect(projectsPanel).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('sidebar-recent-sessions')).toBeInTheDocument()
  })

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
