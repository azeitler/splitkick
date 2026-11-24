import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import {
  SidebarArchivedSection,
  archivedProjectRows,
} from './SidebarArchivedSection'

const mocks = vi.hoisted(() => ({
  worktrees: [] as { project_id: string }[],
  sessions: [] as { project_id: string }[],
  openArchivedView: vi.fn(),
  isMobile: false,
}))

vi.mock('@/services/projects', () => ({
  useArchivedWorktrees: () => ({ data: mocks.worktrees }),
  useProjects: () => ({
    data: [
      { id: 'p-web', name: 'website' },
      { id: 'p-app', name: 'app' },
      { id: 'p-empty', name: 'empty' },
    ],
  }),
}))
vi.mock('@/services/chat', () => ({
  useAllArchivedSessions: () => ({ data: mocks.sessions }),
}))
vi.mock('@/lib/archived-view', () => ({
  openArchivedView: mocks.openArchivedView,
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.isMobile }))

describe('archivedProjectRows', () => {
  it('counts per project, by name, and names a gone project', () => {
    const names = new Map([
      ['p-web', 'website'],
      ['p-app', 'app'],
    ])
    expect(
      archivedProjectRows(['p-web', 'p-gone'], ['p-app', 'p-web'], names)
    ).toEqual([
      { projectId: 'p-app', name: 'app', count: 1 },
      { projectId: 'p-gone', name: 'Unknown project', count: 1 },
      { projectId: 'p-web', name: 'website', count: 2 },
    ])
  })
})

describe('SidebarArchivedSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isMobile = false
    mocks.worktrees = [{ project_id: 'p-web' }]
    mocks.sessions = [{ project_id: 'p-app' }, { project_id: 'p-web' }]
    useUIStore.setState({
      archivedViewOpen: false,
      archivedViewProjectId: null,
      leftSidebarVisible: true,
    })
  })

  it('lists All projects, then only the projects with archived items', () => {
    render(<SidebarArchivedSection />)
    expect(screen.getByTestId('sidebar-archived-all')).toHaveTextContent(
      'All projects3'
    )
    expect(
      screen.getByTestId('sidebar-archived-project-p-app')
    ).toHaveTextContent('app1')
    expect(
      screen.getByTestId('sidebar-archived-project-p-web')
    ).toHaveTextContent('website2')
    expect(screen.queryByTestId('sidebar-archived-project-p-empty')).toBeNull()
  })

  it('marks the row of the open Archived view', () => {
    useUIStore.setState({
      archivedViewOpen: true,
      archivedViewProjectId: 'p-web',
    })
    render(<SidebarArchivedSection />)
    expect(
      screen.getByTestId('sidebar-archived-project-p-web')
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('sidebar-archived-all')).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('marks no row while the Archived view is closed', () => {
    render(<SidebarArchivedSection />)
    expect(screen.getByTestId('sidebar-archived-all')).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('opens the Archived view for a project or for all', async () => {
    render(<SidebarArchivedSection />)
    await userEvent.click(screen.getByTestId('sidebar-archived-project-p-app'))
    expect(mocks.openArchivedView).toHaveBeenLastCalledWith('p-app')
    await userEvent.click(screen.getByTestId('sidebar-archived-all'))
    expect(mocks.openArchivedView).toHaveBeenLastCalledWith(null)
    expect(useUIStore.getState().leftSidebarVisible).toBe(true)
  })

  it('hides the sidebar after a pick on a narrow window', async () => {
    mocks.isMobile = true
    render(<SidebarArchivedSection />)
    await userEvent.click(screen.getByTestId('sidebar-archived-all'))
    expect(useUIStore.getState().leftSidebarVisible).toBe(false)
  })

  it('shows an empty state with nothing archived', () => {
    mocks.worktrees = []
    mocks.sessions = []
    render(<SidebarArchivedSection />)
    expect(screen.getByTestId('sidebar-archived-empty')).toHaveTextContent(
      'Nothing archived'
    )
  })
})
