/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  cancelDialog,
  confirmDialog,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { WorktreeContextMenu } from './WorktreeContextMenu'
import { useWorktreeMenuActions } from './useWorktreeMenuActions'
import type { Worktree } from '@/types/projects'
import type * as ProjectsModule from '@/services/projects'

const serviceMocks = vi.hoisted(() => ({
  archiveMutate: vi.fn(),
  deleteMutate: vi.fn(),
  closeBaseMutate: vi.fn(),
  preferences: {} as { removal_behavior?: 'archive' | 'delete' },
}))

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

if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture ??= vi.fn(() => false)
  Element.prototype.setPointerCapture ??= vi.fn()
}

const actions = {
  showDeleteConfirm: false,
  setShowDeleteConfirm: vi.fn(),
  isBase: false,
  runScripts: [],
  preferences: null,
  handleRun: vi.fn(),
  handleRunCommand: vi.fn(),
  handleOpenInFinder: vi.fn(),
  handleOpenInTerminal: vi.fn(),
  handleOpenInEditor: vi.fn(),
  handleOpenInGitClient: vi.fn(),
  gitClient: null,
  handleArchiveOrClose: vi.fn(),
  handleDelete: vi.fn(),
  handleCopyLink: vi.fn(),
} as unknown as ReturnType<typeof useWorktreeMenuActions>

describe('WorktreeContextMenu rename', () => {
  it('starts the rename only after the menu has closed', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(
      <WorktreeContextMenu actions={actions} onRename={onRename}>
        <span>row</span>
      </WorktreeContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('row'))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

const featureWorktree: Worktree = {
  id: 'wt-1',
  name: 'feature-x',
  path: '/tmp/project/feature-x',
  branch: 'feature-x',
  project_id: 'project-1',
  created_at: 1,
  order: 0,
}

function MenuWithRealActions() {
  const realActions = useWorktreeMenuActions({
    worktree: featureWorktree,
    projectId: 'project-1',
  })
  return (
    <WorktreeContextMenu actions={realActions} onRename={vi.fn()}>
      <span>row</span>
    </WorktreeContextMenu>
  )
}

async function clickArchiveItem() {
  const user = userEvent.setup()
  render(<MenuWithRealActions />)
  fireEvent.contextMenu(screen.getByText('row'))
  await user.click(
    await screen.findByRole('menuitem', { name: 'Archive Worktree' })
  )
}

describe('WorktreeContextMenu archive item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.preferences = {}
  })

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
