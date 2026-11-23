import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDialog,
  confirmDialog,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import type { AiCheckpoint } from '@/types/checkpoints'
import { CheckpointsTabView } from './CheckpointsTabView'

const deleteAiCheckpoint = vi.fn()

const checkpoint: AiCheckpoint = {
  id: 'cp-1',
  worktreeId: 'wt-1',
  sessionId: 'session-1',
  userMessagePreview: 'Add the Acme login page',
  createdAt: Math.floor(Date.now() / 1000),
  startCommit: 'abcdef1234567',
  endCommit: 'fedcba7654321',
  worktreePath: '/Users/me/acme',
  status: 'finalized',
  filesChanged: [],
  totalAdditions: 0,
  totalDeletions: 0,
}

vi.mock('@/services/checkpoints', () => ({
  checkpointQueryKeys: {
    worktree: (id: string) => ['checkpoints', id],
  },
  listAiCheckpoints: () => Promise.resolve([checkpoint]),
  getAiCheckpointDiff: () =>
    Promise.resolve({ raw_patch: '', files: [], stats: null }),
  restoreAiCheckpointFile: vi.fn(),
  deleteAiCheckpoint: (...args: unknown[]) => deleteAiCheckpoint(...args),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@/services/git-status', () => ({ triggerImmediateGitPoll: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}))
vi.mock('./MemoizedFileDiff', () => ({
  MemoizedFileDiff: () => null,
  getStatusColor: () => '',
}))
vi.mock('./CheckpointRestoreDialog', () => ({
  CheckpointRestoreDialog: () => null,
}))
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => null,
}))

async function clickDelete() {
  render(
    <CheckpointsTabView
      worktreeId="wt-1"
      worktreePath="/Users/me/acme"
      diffStyle="unified"
    />
  )
  // The header row of the selected checkpoint holds the trash button.
  await screen.findByText(/Snapshot abcdef1/)
  const icon = document.querySelector('svg.lucide-trash-2')
  expect(icon).toBeTruthy()
  fireEvent.click(icon?.closest('button') as HTMLButtonElement)
  expect(
    await screen.findByText('Delete checkpoint “Add the Acme login page”?')
  ).toBeInTheDocument()
}

describe('CheckpointsTabView delete confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteAiCheckpoint.mockResolvedValue(undefined)
  })

  it('keeps the checkpoint when the dialog is cancelled', async () => {
    await clickDelete()
    await cancelDialog()

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(deleteAiCheckpoint).not.toHaveBeenCalled()
  })

  it('deletes the checkpoint after confirming', async () => {
    await clickDelete()
    await confirmDialog()

    await waitFor(() =>
      expect(deleteAiCheckpoint).toHaveBeenCalledWith('wt-1', 'cp-1')
    )
  })
})
