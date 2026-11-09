import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query-client'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type {
  AllSessionsResponse,
  Session,
  WorktreeSessions,
} from '@/types/chat'

const invokeMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('@/lib/transport', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/transport')>()),
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}))

const { setSessionTodo, toggleSessionTodo, toggleActiveSessionTodo } =
  await import('./session-todo-actions')

function session(extra: Partial<Session> = {}): Session {
  return {
    id: 'session-a',
    name: 'Investigation',
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...extra,
  } as Session
}

function seed(todoAt?: number) {
  const s = session({ todo_at: todoAt })
  queryClient.setQueryData<WorktreeSessions>(
    chatQueryKeys.sessions('worktree-1'),
    {
      worktree_id: 'worktree-1',
      sessions: [s],
      active_session_id: 'session-a',
      version: 2,
    } as WorktreeSessions
  )
  queryClient.setQueryData<AllSessionsResponse>(['all-sessions'], {
    entries: [
      {
        project_id: 'p-1',
        project_name: 'Jean',
        worktree_id: 'worktree-1',
        worktree_name: 'main',
        worktree_path: '/tmp/main',
        sessions: [s],
      },
    ],
  } as AllSessionsResponse)
}

function cachedTodoAt() {
  return {
    tab: queryClient.getQueryData<WorktreeSessions>(
      chatQueryKeys.sessions('worktree-1')
    )?.sessions[0]?.todo_at,
    all: queryClient.getQueryData<AllSessionsResponse>(['all-sessions'])
      ?.entries[0]?.sessions[0]?.todo_at,
  }
}

describe('session To-Do actions', () => {
  beforeEach(() => {
    queryClient.clear()
    invokeMock.mockReset()
    toastErrorMock.mockReset()
  })

  it('marks a session in every cache and sends the command', async () => {
    seed()
    invokeMock.mockResolvedValue(1_700_000_000)

    await expect(
      setSessionTodo({
        sessionId: 'session-a',
        worktreeId: 'worktree-1',
        todo: true,
      })
    ).resolves.toBe(true)

    expect(invokeMock).toHaveBeenCalledWith('set_session_todo', {
      worktreeId: 'worktree-1',
      sessionId: 'session-a',
      todo: true,
    })
    expect(cachedTodoAt()).toEqual({ tab: 1_700_000_000, all: 1_700_000_000 })
  })

  it('shows the mark before the backend answers', () => {
    seed()
    invokeMock.mockReturnValue(new Promise(() => undefined))

    void setSessionTodo({
      sessionId: 'session-a',
      worktreeId: 'worktree-1',
      todo: true,
    })

    expect(cachedTodoAt().tab).toBeGreaterThan(0)
    expect(cachedTodoAt().all).toBeGreaterThan(0)
  })

  it('clears the mark with toggle', async () => {
    seed(42)
    invokeMock.mockResolvedValue(null)

    await toggleSessionTodo(session({ todo_at: 42 }), 'worktree-1')

    expect(invokeMock).toHaveBeenCalledWith(
      'set_session_todo',
      expect.objectContaining({ todo: false })
    )
    expect(cachedTodoAt()).toEqual({ tab: undefined, all: undefined })
  })

  it('restores the old mark and tells the user when the write fails', async () => {
    seed(42)
    invokeMock.mockRejectedValue('disk full')

    await expect(
      setSessionTodo({
        sessionId: 'session-a',
        worktreeId: 'worktree-1',
        todo: false,
        previousTodoAt: 42,
      })
    ).resolves.toBe(false)

    expect(cachedTodoAt()).toEqual({ tab: 42, all: 42 })
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Failed to clear To-Do mark',
      expect.objectContaining({ description: 'disk full' })
    )
  })

  it('the shortcut flips the open session', async () => {
    seed()
    useUIStore.setState({ sessionChatModalOpen: false })
    useChatStore.setState({
      activeWorktreeId: 'worktree-1',
      activeSessionIds: { 'worktree-1': 'session-a' },
    })
    invokeMock.mockResolvedValue(7)

    await expect(toggleActiveSessionTodo(queryClient)).resolves.toBe(true)

    expect(invokeMock).toHaveBeenCalledWith('set_session_todo', {
      worktreeId: 'worktree-1',
      sessionId: 'session-a',
      todo: true,
    })
  })
})
