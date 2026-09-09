import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test/test-utils'
import { ProjectTreeItem } from './ProjectTreeItem'
import type { Project, Worktree } from '@/types/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'

const mocks = vi.hoisted(() => ({
  worktrees: [] as Worktree[],
  updateSettingsMutate: vi.fn(),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

vi.mock('@/hooks/useRemotePicker', () => ({
  useRemotePicker: () => (run: (remote?: string) => void) => run(),
}))

vi.mock('@/services/projects', () => ({
  useWorktrees: () => ({ data: mocks.worktrees }),
  useAppDataDir: () => ({ data: '' }),
  useUpdateProjectSettings: () => ({
    mutate: mocks.updateSettingsMutate,
    isPending: false,
  }),
}))

vi.mock('@/services/git-status', () => ({
  useFetchWorktreesStatus: () => undefined,
  useGitStatus: () => ({ data: null }),
  gitPush: vi.fn(),
  fetchWorktreesStatus: vi.fn(),
  performGitPull: vi.fn(),
}))

vi.mock('@/components/shared/NewIssuesBadge', () => ({
  NewIssuesBadge: () => null,
}))
vi.mock('@/components/shared/OpenPRsBadge', () => ({
  OpenPRsBadge: () => null,
}))
vi.mock('@/components/shared/FailedRunsBadge', () => ({
  FailedRunsBadge: () => null,
}))
vi.mock('@/components/shared/SecurityAlertsBadge', () => ({
  SecurityAlertsBadge: () => null,
}))

vi.mock('./WorktreeList', () => ({
  WorktreeList: ({ sessionFilterQuery }: { sessionFilterQuery?: string }) => (
    <div data-testid="worktree-list" data-filter={sessionFilterQuery ?? ''} />
  ),
}))

vi.mock('./ProjectContextMenu', () => ({
  ProjectContextMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

const project: Project = {
  id: 'project-1',
  name: 'jean',
  path: '/tmp/jean',
  default_branch: 'main',
  added_at: 0,
  order: 0,
}

const worktree: Worktree = {
  id: 'wt-1',
  project_id: 'project-1',
  name: 'feature',
  path: '/tmp/jean-feature',
  branch: 'feature',
  created_at: 0,
  order: 0,
  status: 'ready',
  session_type: 'worktree',
}

describe('ProjectTreeItem', () => {
  beforeEach(() => {
    mocks.worktrees = [worktree]
    mocks.updateSettingsMutate.mockReset()
    useProjectsStore.setState({
      selectedProjectId: 'project-1',
      selectedWorktreeId: 'wt-1',
      expandedProjectIds: new Set(['project-1']),
      expandedWorktreeIds: new Set(),
      expandedFolderIds: new Set(),
      projectAccessTimestamps: {},
      projectCanvasSettings: {},
      githubDashboardFavoriteProjectIds: [],
      addProjectDialogOpen: false,
      addProjectParentFolderId: null,
      projectSettingsDialogOpen: false,
      projectSettingsProjectId: null,
      projectSettingsInitialPane: null,
      gitInitModalOpen: false,
      gitInitModalPath: null,
      cloneModalOpen: false,
      jeanConfigWizardOpen: false,
      jeanConfigWizardProjectId: null,
      editingFolderId: null,
    })
    useChatStore.setState({
      activeWorktreeId: 'wt-1',
      activeWorktreePath: '/tmp/jean-feature',
    })
  })

  it('opens the project canvas on a row click without collapsing the project', async () => {
    const user = userEvent.setup()
    render(<ProjectTreeItem project={project} />)

    await user.click(screen.getByTestId('project-row-project-1'))

    const projectsState = useProjectsStore.getState()
    expect(projectsState.selectedProjectId).toBe('project-1')
    // Leaving the chat is what puts the canvas on screen.
    expect(useChatStore.getState().activeWorktreeId).toBeNull()
    expect(useChatStore.getState().activeWorktreePath).toBeNull()
    // The chevron owns the open/closed state, not the row.
    expect(projectsState.expandedProjectIds.has('project-1')).toBe(true)
  })

  it('collapses the project from the chevron only', async () => {
    const user = userEvent.setup()
    render(<ProjectTreeItem project={project} />)

    await user.click(screen.getByRole('button', { name: 'Collapse project' }))

    expect(
      useProjectsStore.getState().expandedProjectIds.has('project-1')
    ).toBe(false)
    // The chevron must not move the selection either.
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('wt-1')
  })

  it('opens project canvas when the project has no worktrees', async () => {
    mocks.worktrees = []
    const user = userEvent.setup()
    render(<ProjectTreeItem project={project} />)

    await user.click(screen.getByTestId('project-row-project-1'))

    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(useProjectsStore.getState().selectedWorktreeId).toBeNull()
    expect(useChatStore.getState().activeWorktreeId).toBeNull()
    expect(useChatStore.getState().activeWorktreePath).toBeNull()
  })

  it('hides the workspace count badge while the project is expanded', () => {
    render(<ProjectTreeItem project={project} />)

    expect(screen.queryByTestId('collapsed-count-badge')).toBeNull()
  })

  it('shows the workspace count badge while the project is collapsed', () => {
    useProjectsStore.setState({ expandedProjectIds: new Set() })
    render(<ProjectTreeItem project={project} />)

    expect(screen.getByTestId('collapsed-count-badge')).toHaveTextContent('1')
    expect(screen.getByLabelText('1 workspace')).toBeInTheDocument()
  })

  it('passes the typed filter down to the worktree list', async () => {
    const user = userEvent.setup()
    render(<ProjectTreeItem project={project} />)

    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.type(
      screen.getByTestId('project-session-filter-project-1'),
      'auth'
    )

    await waitFor(() =>
      expect(screen.getByTestId('worktree-list')).toHaveAttribute(
        'data-filter',
        'auth'
      )
    )
  })

  it('reveals a collapsed project while filtering without expanding it', async () => {
    useProjectsStore.setState({ expandedProjectIds: new Set() })
    const user = userEvent.setup()
    render(<ProjectTreeItem project={project} />)

    expect(screen.queryByTestId('worktree-list')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.type(
      screen.getByTestId('project-session-filter-project-1'),
      'auth'
    )

    await waitFor(() =>
      expect(screen.getByTestId('worktree-list')).toBeInTheDocument()
    )
    // The persisted expansion state must stay untouched.
    expect(useProjectsStore.getState().expandedProjectIds.size).toBe(0)
  })

  it('closes and clears the filter on Escape', async () => {
    const user = userEvent.setup()
    render(<ProjectTreeItem project={project} />)

    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    const input = screen.getByTestId('project-session-filter-project-1')
    await user.type(input, 'auth')
    await user.type(input, '{Escape}')

    expect(screen.queryByTestId('project-session-filter-project-1')).toBeNull()

    // Reopening starts empty.
    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    expect(screen.getByTestId('project-session-filter-project-1')).toHaveValue(
      ''
    )
  })

  it('hides the filter toggle for a project without worktrees', () => {
    mocks.worktrees = []
    render(<ProjectTreeItem project={project} />)

    expect(screen.queryByRole('button', { name: 'Filter sessions' })).toBeNull()
  })

  it('starts inline rename on double-click and renames on Enter', async () => {
    const user = userEvent.setup()
    render(<ProjectTreeItem project={project} />)

    await user.dblClick(screen.getByTestId('project-row-project-1'))

    const input = screen.getByRole('textbox', { name: 'Project name' })
    expect(input).toHaveValue('jean')

    await user.clear(input)
    await user.type(input, 'jean-app{Enter}')

    expect(mocks.updateSettingsMutate).toHaveBeenCalledWith({
      projectId: 'project-1',
      name: 'jean-app',
    })
  })
})
