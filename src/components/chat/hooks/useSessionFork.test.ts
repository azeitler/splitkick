import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@/test/test-utils'
import { useSessionFork } from './useSessionFork'
import { useChatStore } from '@/store/chat-store'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))
const { invoke, invalidateQueries, toastSuccess, toastError } = mocks

vi.mock('@/lib/transport', () => ({ invoke: mocks.invoke }))

vi.mock('@/lib/query-client', () => ({
  queryClient: {
    invalidateQueries: mocks.invalidateQueries,
    setQueryData: mocks.setQueryData,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    loading: () => 'toast-1',
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function forkedSession(id: string) {
  return { id, name: 'Fork of Build auth' }
}

describe('useSessionFork.forkInPlace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forks the whole session and selects the result', async () => {
    invoke.mockResolvedValue(forkedSession('new-session'))
    const { result } = renderHook(() => useSessionFork())

    await result.current.forkInPlace({
      worktreeId: 'wt-1',
      sessionId: 'sess-1',
    })

    expect(invoke).toHaveBeenCalledWith('fork_session_in_place', {
      worktreeId: 'wt-1',
      sessionId: 'sess-1',
      fromMessageId: null,
    })
    expect(useChatStore.getState().getActiveSession('wt-1')).toBe('new-session')
    expect(useChatStore.getState().userInitiatedSessionIds['new-session']).toBe(
      true
    )
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('passes the message id through when forking from a message', async () => {
    invoke.mockResolvedValue(forkedSession('new-session'))
    const { result } = renderHook(() => useSessionFork())

    await result.current.forkInPlace({
      worktreeId: 'wt-1',
      sessionId: 'sess-1',
      fromMessageId: 'msg-7',
    })

    expect(invoke).toHaveBeenCalledWith('fork_session_in_place', {
      worktreeId: 'wt-1',
      sessionId: 'sess-1',
      fromMessageId: 'msg-7',
    })
  })

  it('refreshes the session lists the fork appears in', async () => {
    invoke.mockResolvedValue(forkedSession('new-session'))
    const { result } = renderHook(() => useSessionFork())

    await result.current.forkInPlace({
      worktreeId: 'wt-1',
      sessionId: 'sess-1',
    })

    const invalidated = invalidateQueries.mock.calls.map(
      ([arg]) => (arg as { queryKey: unknown[] }).queryKey
    )
    expect(invalidated).toContainEqual(['chat', 'sessions', 'wt-1'])
    expect(invalidated).toContainEqual(['all-sessions'])
  })

  it('reports a failure without selecting anything', async () => {
    invoke.mockRejectedValue('session is running')
    const { result } = renderHook(() => useSessionFork())

    await result.current.forkInPlace({
      worktreeId: 'wt-empty',
      sessionId: 'sess-1',
    })

    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining('session is running'),
      expect.anything()
    )
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(useChatStore.getState().getActiveSession('wt-empty')).toBeUndefined()
  })
})

describe('useSessionFork.forkToWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the worktree fork command with the source ids', async () => {
    invoke.mockResolvedValue({
      worktree: {
        id: 'wt-2',
        path: '/tmp/fork',
        project_id: 'proj-1',
        name: 'fork-main',
      },
      session: forkedSession('new-session'),
    })
    const { result } = renderHook(() => useSessionFork())

    await result.current.forkToWorktree({
      worktreeId: 'wt-1',
      sessionId: 'sess-1',
    })

    expect(invoke).toHaveBeenCalledWith('fork_session_to_worktree', {
      sourceWorktreeId: 'wt-1',
      sourceSessionId: 'sess-1',
    })
    expect(toastSuccess).toHaveBeenCalled()
  })
})
