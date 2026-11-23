import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cancelDialog,
  confirmDialog,
  render,
  renderHook,
  screen,
} from '@/test/test-utils'
import type { SavedContext } from '@/types/chat'
import { useLoadContextHandlers } from './useLoadContextHandlers'

const invokeMock = vi.fn()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast'),
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/gh-cli-setup', () => ({ toastGitHubError: vi.fn() }))
vi.mock('@/services/github', () => ({}))

const context: SavedContext = {
  id: 'ctx-1',
  filename: 'acme-plan.md',
  path: '/Users/me/contexts/acme-plan.md',
  project_name: 'Acme',
  slug: 'acme-plan',
  size: 100,
  created_at: 0,
  name: 'Acme plan',
}

function setup() {
  const refetchContexts = vi.fn()
  const noop = vi.fn()
  // test-utils mounts <ConfirmDialogHost /> next to the rendered element.
  render(<></>)
  const { result } = renderHook(() =>
    useLoadContextHandlers({
      activeSessionId: 'session-1',
      worktreePath: '/Users/me/acme',
      worktreeId: 'wt-1',
      projectId: 'project-1',
      refetchIssueContexts: noop,
      refetchPRContexts: noop,
      refetchSecurityContexts: noop,
      refetchAdvisoryContexts: noop,
      refetchAttachedContexts: noop,
      refetchLinearContexts: noop,
      refetchSentryContexts: noop,
      refetchContexts,
      renameMutation: { mutate: noop },
      preferences: undefined,
      onClearSearch: noop,
    })
  )
  const event = { stopPropagation: vi.fn() } as unknown as React.MouseEvent
  let done: Promise<void> | undefined
  act(() => {
    done = result.current.handleDeleteContext(event, context)
  })
  return { done, refetchContexts }
}

describe('useLoadContextHandlers handleDeleteContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockResolvedValue(null)
  })

  it('keeps the saved context when the dialog is cancelled', async () => {
    const { done, refetchContexts } = setup()
    expect(
      await screen.findByText('Delete saved context “Acme plan”?')
    ).toBeInTheDocument()

    await cancelDialog()
    await act(async () => {
      await done
    })

    expect(invokeMock).not.toHaveBeenCalled()
    expect(refetchContexts).not.toHaveBeenCalled()
  })

  it('deletes the saved context after confirming', async () => {
    const { done, refetchContexts } = setup()
    await screen.findByText('Delete saved context “Acme plan”?')

    await confirmDialog()
    await act(async () => {
      await done
    })

    expect(invokeMock).toHaveBeenCalledWith('delete_context_file', {
      path: '/Users/me/contexts/acme-plan.md',
    })
    expect(refetchContexts).toHaveBeenCalledTimes(1)
  })
})
