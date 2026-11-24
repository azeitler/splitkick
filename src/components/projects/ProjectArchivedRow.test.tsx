import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { ProjectArchivedRow } from './ProjectArchivedRow'

const mocks = vi.hoisted(() => ({
  worktrees: [] as { id: string; project_id: string }[],
  sessions: [] as { project_id: string; session: { id: string } }[],
  isMobile: false,
}))

vi.mock('@/services/projects', () => ({
  useArchivedWorktrees: () => ({ data: mocks.worktrees }),
}))
vi.mock('@/services/chat', () => ({
  useAllArchivedSessions: () => ({ data: mocks.sessions }),
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.isMobile }))

const rowId = (projectId: string) => `project-archived-row-${projectId}`

describe('ProjectArchivedRow', () => {
  beforeEach(() => {
    mocks.worktrees = [{ id: 'w1', project_id: 'p1' }]
    mocks.sessions = [
      { project_id: 'p1', session: { id: 's1' } },
      { project_id: 'p1', session: { id: 's2' } },
      { project_id: 'p2', session: { id: 's3' } },
    ]
    mocks.isMobile = false
    useUIStore.setState({
      archivedViewOpen: false,
      archivedViewProjectId: null,
      activeScheduleId: null,
      leftSidebarVisible: true,
    })
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
  })

  it('shows nothing for a project with nothing archived', () => {
    render(<ProjectArchivedRow projectId="p3" />)
    expect(screen.queryByTestId(rowId('p3'))).toBeNull()
  })

  it("counts the project's archived worktrees and sessions", () => {
    render(<ProjectArchivedRow projectId="p1" />)
    const row = screen.getByTestId(rowId('p1'))
    expect(row).toHaveTextContent('Archived')
    expect(screen.getByLabelText('3 archived items')).toHaveTextContent('3')
  })

  it('opens the Archived view filtered to the project', async () => {
    render(<ProjectArchivedRow projectId="p2" />)
    await userEvent.click(screen.getByTestId(rowId('p2')))

    const ui = useUIStore.getState()
    expect(ui.archivedViewOpen).toBe(true)
    expect(ui.archivedViewProjectId).toBe('p2')
    expect(screen.getByTestId(rowId('p2'))).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('marks itself while the Archived view is filtered to its project', () => {
    useUIStore.setState({ archivedViewOpen: true, archivedViewProjectId: 'p1' })
    render(<ProjectArchivedRow projectId="p1" />)
    expect(screen.getByTestId(rowId('p1'))).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('is not marked while the Archived view shows another project', () => {
    useUIStore.setState({ archivedViewOpen: true, archivedViewProjectId: null })
    render(<ProjectArchivedRow projectId="p1" />)
    expect(screen.getByTestId(rowId('p1'))).not.toHaveAttribute('aria-current')
  })

  it('asks for the dialog with the project on a phone', async () => {
    mocks.isMobile = true
    const handler = vi.fn()
    window.addEventListener('command:open-archived-modal', handler)
    render(<ProjectArchivedRow projectId="p1" />)
    await userEvent.click(screen.getByTestId(rowId('p1')))
    window.removeEventListener('command:open-archived-modal', handler)

    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      projectId: 'p1',
    })
    expect(useUIStore.getState().leftSidebarVisible).toBe(false)
    expect(useUIStore.getState().archivedViewOpen).toBe(false)
  })
})
