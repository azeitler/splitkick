import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { queryClient } from '@/lib/query-client'
import { isWsDisconnectError } from '@/lib/query-error'
import { invoke } from '@/lib/transport'
import { getActiveSessionTarget } from '@/lib/session-transfer'
import { getActiveSessionFromCache } from '@/lib/session-graph-panel'
import { chatQueryKeys } from '@/services/chat'
import type { AllSessionsResponse, Session } from '@/types/chat'

/**
 * The To-Do mark of a session (#125) lives on the session metadata as
 * `todo_at` (unix seconds), so web access, remote instances and agents see it.
 * Only the `set_session_todo` command writes it; the backend then sends a
 * worktree-scoped `cache:invalidate` to every client.
 */

type TodoAt = number | undefined

function withTodo(session: Session, sessionId: string, todoAt: TodoAt) {
  if (session.id !== sessionId || session.todo_at === todoAt) return session
  return { ...session, todo_at: todoAt }
}

/** Write a session's mark into every cache that shows it. */
export function patchSessionTodoInCaches(
  client: QueryClient,
  worktreeId: string,
  sessionId: string,
  todoAt: TodoAt
): void {
  // The tab bar list and its variants (e.g. "with-counts") share this prefix.
  client.setQueriesData<{ sessions?: Session[] }>(
    { queryKey: chatQueryKeys.sessions(worktreeId) },
    old => {
      if (!old || !Array.isArray(old.sessions)) return old
      const sessions = old.sessions.map(s => withTodo(s, sessionId, todoAt))
      return sessions.some((s, i) => s !== old.sessions?.[i])
        ? { ...old, sessions }
        : old
    }
  )
  client.setQueryData<Session>(chatQueryKeys.session(sessionId), old =>
    old ? withTodo(old, sessionId, todoAt) : old
  )
  client.setQueryData<AllSessionsResponse>(['all-sessions'], old => {
    if (!old) return old
    let changed = false
    const entries = old.entries.map(entry => {
      const sessions = entry.sessions.map(s => withTodo(s, sessionId, todoAt))
      if (sessions.every((s, i) => s === entry.sessions[i])) return entry
      changed = true
      return { ...entry, sessions }
    })
    return changed ? { ...old, entries } : old
  })
}

/** A session as the tab bar or the open chat has it cached, or undefined. */
export function findCachedSession(
  client: QueryClient,
  worktreeId: string,
  sessionId: string
): Session | undefined {
  for (const key of [
    chatQueryKeys.sessions(worktreeId),
    [...chatQueryKeys.sessions(worktreeId), 'with-counts'],
  ]) {
    const found = client
      .getQueryData<{ sessions?: Session[] }>(key)
      ?.sessions?.find(s => s.id === sessionId)
    if (found) return found
  }
  return (
    client.getQueryData<Session>(chatQueryKeys.session(sessionId)) ?? undefined
  )
}

function isInAllSessions(client: QueryClient, sessionId: string): boolean {
  const data = client.getQueryData<AllSessionsResponse>(['all-sessions'])
  return !!data?.entries.some(entry =>
    entry.sessions.some(s => s.id === sessionId)
  )
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unknown error occurred'
}

interface SetSessionTodoArgs {
  sessionId: string
  worktreeId: string
  todo: boolean
  /** The mark the screen shows now; restored when the write fails. */
  previousTodoAt?: number
}

/**
 * Mark a session as To-Do or clear the mark. The screen changes at once; when
 * the write fails, the old mark comes back and a toast says why.
 */
export async function setSessionTodo({
  sessionId,
  worktreeId,
  todo,
  previousTodoAt,
}: SetSessionTodoArgs): Promise<boolean> {
  const optimistic = todo
    ? (previousTodoAt ?? Math.floor(Date.now() / 1000))
    : undefined
  patchSessionTodoInCaches(queryClient, worktreeId, sessionId, optimistic)

  try {
    const todoAt = await invoke<number | null>('set_session_todo', {
      worktreeId,
      sessionId,
      todo,
    })
    patchSessionTodoInCaches(
      queryClient,
      worktreeId,
      sessionId,
      todoAt ?? undefined
    )
    // The To-Do lists read the all-sessions cache. A session created since
    // its last fetch is not in it, so its row would never show. Refetch.
    if (todo && !isInAllSessions(queryClient, sessionId)) {
      void queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
    }
    return true
  } catch (error) {
    patchSessionTodoInCaches(queryClient, worktreeId, sessionId, previousTodoAt)
    // The web client reloads from disk after a drop, so a toast is noise.
    if (!isWsDisconnectError(error)) {
      const action = todo ? 'mark session as To-Do' : 'clear To-Do mark'
      logger.error(`Failed to ${action}`, { error, sessionId })
      toast.error(`Failed to ${action}`, { description: describeError(error) })
    }
    return false
  }
}

/** Flip the mark of a session. */
export function toggleSessionTodo(
  session: Pick<Session, 'id' | 'todo_at'>,
  worktreeId: string
): Promise<boolean> {
  return setSessionTodo({
    sessionId: session.id,
    worktreeId,
    todo: !session.todo_at,
    previousTodoAt: session.todo_at,
  })
}

/** Flip the mark of the open session (the `toggle_session_todo` shortcut). */
export function toggleActiveSessionTodo(client: QueryClient): Promise<boolean> {
  const target = getActiveSessionTarget()
  const session = getActiveSessionFromCache(client)
  if (!target || !session) return Promise.resolve(false)
  return toggleSessionTodo(session, target.worktreeId)
}
