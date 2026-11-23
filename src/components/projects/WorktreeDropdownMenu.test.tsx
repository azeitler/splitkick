import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  cancelDialog,
  confirmDialog,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { WorktreeDropdownMenu } from './WorktreeDropdownMenu'
import type { Worktree } from '@/types/projects'
import type * as EnvironmentModule from '@/lib/environment'
import type * as ProjectsModule from '@/services/projects'
import type * as MenuActionsModule from './useWorktreeMenuActions'

const envMocks = vi.hoisted(() => ({
  isNativeApp: false,
  isLocalBackend: false,
  canOpenNativeApps: false,
  canOpenInEditor: false,
  isMobile: true,
}))

const actionMocks = vi.hoisted(() => ({
  handleRun: vi.fn(),
  handleRunCommand: vi.fn(),
  runScripts: ['bun run dev'] as string[],
  useRealActions: false,
}))

const serviceMocks = vi.hoisted(() => ({
  archiveMutate: vi.fn(),
  deleteMutate: vi.fn(),
  closeBaseMutate: vi.fn(),
  preferences: {} as { removal_behavior?: 'archive' | 'delete' },
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof EnvironmentModule>()),
  isNativeApp: () => envMocks.isNativeApp,
  isLocalBackend: () => envMocks.isLocalBackend,
  canOpenNativeApps: () => envMocks.canOpenNativeApps,
  canOpenInEditor: () => envMocks.canOpenInEditor,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => envMocks.isMobile,
}))

vi.mock('@/services/gh-cli', () => ({
  ghCliQueryKeys: { auth: () => ['gh-cli', 'auth'] },
  useGhCliAuth: () => ({}),
}))

vi.mock('@/services/github', () => ({
  useDependabotAlerts: () => ({ data: [] }),
  useGitHubIssues: () => ({ data: { totalCount: 0 } }),
  useGitHubPRs: () => ({ data: [] }),
  useRepositoryAdvisories: () => ({ data: [] }),
  useWorkflowRuns: () => ({ data: { runs: [], failedCount: 0 } }),
}))

vi.mock('./useWorktreeMenuActions', async importOriginal => {
  const actual = await importOriginal<typeof MenuActionsModule>()
  return {
    useWorktreeMenuActions: (
      props: Parameters<typeof actual.useWorktreeMenuActions>[0]
    ) =>
      actionMocks.useRealActions
        ? actual.useWorktreeMenuActions(props)
        : {
            showDeleteConfirm: false,
            setShowDeleteConfirm: vi.fn(),
            isBase: false,
            runScripts: actionMocks.runScripts,
            preferences: {},
            handleRun: actionMocks.handleRun,
            handleRunCommand: actionMocks.handleRunCommand,
            handleOpenInFinder: vi.fn(),
            handleOpenInTerminal: vi.fn(),
            handleOpenInEditor: vi.fn(),
            handleArchiveOrClose: vi.fn(),
            handleDelete: vi.fn(),
          },
  }
})

vi.mock('@/services/projects', async importOriginal => ({
  ...(await importOriginal<typeof ProjectsModule>()),
  useArchiveWorktree: () => ({ mutate: serviceMocks.archiveMutate }),
  useDeleteWorktree: () => ({ mutate: serviceMocks.deleteMutate }),
  useCloseBaseSession: () => ({ mutate: serviceMocks.closeBaseMutate }),
  useRunScripts: () => ({ data: [] }),
  useIsPlainProject: () => false,
  useInstalledApps: () => ({ data: new Set<string>() }),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: serviceMocks.preferences }),
}))

vi.mock('@/services/chat', () => ({
  useSessions: () => ({ data: { sessions: [] } }),
}))

const worktree: Worktree = {
  id: 'wt-1',
  name: 'feature',
  path: '/tmp/project/feature',
  branch: 'feature',
  base_branch: 'main',
  project_id: 'project-1',
  created_at: 1767225600000,
  order: 0,
}

describe('WorktreeDropdownMenu', () => {
  beforeEach(() => {
    envMocks.isNativeApp = false
    envMocks.isLocalBackend = false
    envMocks.canOpenNativeApps = false
    envMocks.canOpenInEditor = false
    envMocks.isMobile = true
    actionMocks.runScripts = ['bun run dev']
    actionMocks.useRealActions = false
    actionMocks.handleRun.mockClear()
    actionMocks.handleRunCommand.mockClear()
  })

  it('hides the jean.json run command in mobile web access', async () => {
    const user = userEvent.setup()

    render(
      <WorktreeDropdownMenu
        worktree={worktree}
        projectId="project-1"
        projectPath="/tmp/project"
      />
    )

    await user.click(screen.getByRole('button'))

    expect(screen.queryByRole('menuitem', { name: /run/i })).toBeNull()
    expect(actionMocks.handleRun).not.toHaveBeenCalled()
  })

  it('disables open-in editor/terminal/finder on remote connections without native open', async () => {
    const user = userEvent.setup()
    envMocks.isNativeApp = true
    envMocks.isLocalBackend = false
    envMocks.canOpenNativeApps = false
    envMocks.canOpenInEditor = false
    envMocks.isMobile = false

    render(
      <WorktreeDropdownMenu
        worktree={worktree}
        projectId="project-1"
        projectPath="/tmp/project"
      />
    )

    await user.click(screen.getByRole('button'))

    const openItems = screen.getAllByRole('menuitem', { name: /open in/i })
    expect(openItems).toHaveLength(3)
    for (const item of openItems) {
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveTextContent('Host only')
    }
  })

  it('shows open-in editor when the native shell can open remote paths in Zed', async () => {
    const user = userEvent.setup()
    envMocks.isNativeApp = true
    envMocks.isLocalBackend = false
    envMocks.canOpenNativeApps = false
    envMocks.canOpenInEditor = true
    envMocks.isMobile = false

    render(
      <WorktreeDropdownMenu
        worktree={worktree}
        projectId="project-1"
        projectPath="/tmp/project"
      />
    )

    await user.click(screen.getByRole('button'))

    const finder = screen.getByRole('menuitem', { name: /finder/i })
    expect(finder).toHaveAttribute('aria-disabled', 'true')
    expect(finder).toHaveTextContent('Host only')
    const editor = screen
      .getAllByRole('menuitem', { name: /open in/i })
      .find(item => !/finder|terminal/i.test(item.textContent ?? ''))
    expect(editor).toBeDefined()
    expect(editor).not.toHaveAttribute('aria-disabled')
    expect(editor).not.toHaveTextContent('Host only')
  })

  it('shows open-in editor/terminal/finder when the remote backend allows native open', async () => {
    const user = userEvent.setup()
    envMocks.isNativeApp = true
    envMocks.isLocalBackend = false
    envMocks.canOpenNativeApps = true
    envMocks.canOpenInEditor = true
    envMocks.isMobile = false

    render(
      <WorktreeDropdownMenu
        worktree={worktree}
        projectId="project-1"
        projectPath="/tmp/project"
      />
    )

    await user.click(screen.getByRole('button'))

    const openItems = screen.getAllByRole('menuitem', { name: /open in/i })
    expect(openItems).toHaveLength(3)
    for (const item of openItems) {
      expect(item).not.toHaveAttribute('aria-disabled')
    }
    expect(screen.queryByText('Host only')).toBeNull()
  })
})

describe('WorktreeDropdownMenu archive item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envMocks.isNativeApp = true
    envMocks.isLocalBackend = true
    envMocks.canOpenNativeApps = true
    envMocks.canOpenInEditor = true
    envMocks.isMobile = false
    actionMocks.useRealActions = true
    serviceMocks.preferences = {}
  })

  async function clickArchiveItem() {
    const user = userEvent.setup()
    render(
      <WorktreeDropdownMenu
        worktree={{ ...worktree, name: 'feature-x' }}
        projectId="project-1"
        projectPath="/tmp/project"
      />
    )
    await user.click(screen.getByRole('button'))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Archive Worktree' })
    )
  }

  it('archives at once without a dialog when removal behavior is archive', async () => {
    serviceMocks.preferences = { removal_behavior: 'archive' }
    await clickArchiveItem()

    await waitFor(() =>
      expect(serviceMocks.archiveMutate).toHaveBeenCalledWith({
        worktreeId: 'wt-1',
        projectId: 'project-1',
      })
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(serviceMocks.deleteMutate).not.toHaveBeenCalled()
  })

  it('does not delete when the delete confirmation is cancelled', async () => {
    serviceMocks.preferences = { removal_behavior: 'delete' }
    await clickArchiveItem()

    expect(
      await screen.findByRole('alertdialog', {
        name: 'Delete worktree “feature-x”?',
      })
    ).toBeInTheDocument()
    await cancelDialog()

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(serviceMocks.deleteMutate).not.toHaveBeenCalled()
    expect(serviceMocks.archiveMutate).not.toHaveBeenCalled()
  })

  it('deletes the worktree after the delete confirmation', async () => {
    serviceMocks.preferences = { removal_behavior: 'delete' }
    await clickArchiveItem()

    await screen.findByRole('alertdialog', {
      name: 'Delete worktree “feature-x”?',
    })
    expect(serviceMocks.deleteMutate).not.toHaveBeenCalled()
    await confirmDialog()

    await waitFor(() =>
      expect(serviceMocks.deleteMutate).toHaveBeenCalledWith({
        worktreeId: 'wt-1',
        projectId: 'project-1',
      })
    )
    expect(serviceMocks.archiveMutate).not.toHaveBeenCalled()
  })
})
