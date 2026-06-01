import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { GitDiffModal } from './GitDiffModal'
import type { GitDiff } from '@/types/git-diff'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: {} }),
}))

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

vi.mock('./MemoizedFileDiff', () => ({
  MemoizedFileDiff: ({ fileName }: { fileName: string }) => (
    <div data-testid="file-diff">{fileName}</div>
  ),
  getStatusColor: () => 'text-blue-500',
}))

const mockDiff: GitDiff = {
  diff_type: 'uncommitted',
  base_ref: 'HEAD',
  target_ref: 'working tree',
  total_additions: 1,
  total_deletions: 0,
  raw_patch: '',
  files: [
    {
      path: 'src/example.ts',
      old_path: null,
      status: 'modified',
      additions: 1,
      deletions: 0,
      is_binary: false,
      hunks: [],
    },
  ],
}

vi.mock('@/services/git-status', () => ({
  getGitDiff: vi.fn(async () => mockDiff),
  revertFile: vi.fn(),
  triggerImmediateGitPoll: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

function renderGitDiffModal() {
  return render(
    <GitDiffModal
      diffRequest={{
        type: 'uncommitted',
        worktreePath: '/tmp/worktree',
        baseBranch: 'main',
      }}
      onClose={vi.fn()}
    />
  )
}

describe('GitDiffModal keyboard shortcuts', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  })

  it('focuses the file filter when slash is pressed outside editable fields', async () => {
    const user = userEvent.setup()
    renderGitDiffModal()

    const filterInput = await screen.findByPlaceholderText('Filter files...')
    expect(filterInput).not.toHaveFocus()

    await user.keyboard('/')

    await waitFor(() => {
      expect(filterInput).toHaveFocus()
    })
  })

  it('does not steal slash while the user is typing in the file filter', async () => {
    renderGitDiffModal()

    const filterInput = await screen.findByPlaceholderText('Filter files...')

    const wasNotPrevented = fireEvent.keyDown(filterInput, {
      key: '/',
      cancelable: true,
    })

    expect(wasNotPrevented).toBe(true)
  })
})
