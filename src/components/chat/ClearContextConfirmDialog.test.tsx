import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import {
  ClearContextConfirmDialog,
  requestClearSessionContext,
} from './ClearContextConfirmDialog'
import { useChatStore } from '@/store/chat-store'

const mutate = vi.fn()
const toastInfo = vi.fn()

vi.mock('@/services/chat', () => ({
  useClearSessionHistory: () => ({ mutate, isPending: false }),
}))

vi.mock('sonner', () => ({
  toast: { info: (...args: unknown[]) => toastInfo(...args) },
}))

const target = {
  worktreeId: 'wt-1',
  worktreePath: '/tmp/wt-1',
  sessionId: 'session-1',
}

function openDialog() {
  render(<ClearContextConfirmDialog />)
  act(() => requestClearSessionContext(target))
}

describe('ClearContextConfirmDialog', () => {
  beforeEach(() => {
    mutate.mockReset()
    toastInfo.mockReset()
    useChatStore.setState({ sendingSessionIds: {} })
  })

  it('stays closed until a clear is requested', () => {
    render(<ClearContextConfirmDialog />)
    expect(screen.queryByText('Clear context?')).not.toBeInTheDocument()
  })

  it('does not clear when the user cancels', async () => {
    openDialog()
    expect(screen.getByText('Clear context?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mutate).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByText('Clear context?')).not.toBeInTheDocument()
    )
  })

  it('clears the requested session when the user confirms', async () => {
    openDialog()

    await userEvent.click(screen.getByRole('button', { name: 'Clear Context' }))

    expect(mutate).toHaveBeenCalledWith(target, expect.any(Object))
  })

  it('refuses to clear a session that is still sending', async () => {
    useChatStore.setState({ sendingSessionIds: { 'session-1': true } })
    openDialog()

    await userEvent.click(screen.getByRole('button', { name: 'Clear Context' }))

    expect(mutate).not.toHaveBeenCalled()
    expect(toastInfo).toHaveBeenCalled()
  })
})
