import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { AllSessionsResponse } from '@/types/chat'

/**
 * Stamp `last_opened_at` on the named sessions in the all-sessions cache.
 * Returns false when a session is not in the cache, so the caller refetches.
 */
export function markSessionsOpenedInCache(
  queryClient: QueryClient,
  sessionIds: readonly string[]
): boolean {
  const data = queryClient.getQueryData<AllSessionsResponse>(['all-sessions'])
  if (!data) return true // Nothing cached: the first read loads fresh data.
  const pending = new Set(sessionIds)
  const now = Math.floor(Date.now() / 1000)
  const entries = data.entries.map(entry => {
    if (!entry.sessions.some(s => pending.has(s.id))) return entry
    return {
      ...entry,
      sessions: entry.sessions.map(session => {
        if (!pending.has(session.id)) return session
        pending.delete(session.id)
        return { ...session, last_opened_at: now }
      }),
    }
  })
  queryClient.setQueryData<AllSessionsResponse>(['all-sessions'], {
    ...data,
    entries,
  })
  return pending.size === 0
}

/**
 * Update the all-sessions cache whenever a session is opened.
 *
 * Opening a session stamps its `last_opened_at`, which is what the unread
 * count, the phone's History tab and its Unread list read. Mounted by the
 * unread bell on the desktop and by the phone's tab shell, which has no bell.
 *
 * The event names the sessions, so the cache is patched in place. A full
 * refetch here re-read every session of every project (500 KB with 400
 * sessions) on each open; the server's `cache:invalidate` for the session's
 * worktree already refreshes that worktree's entry with the saved value.
 */
export function useRefreshSessionsOnOpen(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const handler = (event: Event) => {
      const ids = (event as CustomEvent<{ sessionIds?: string[] }>).detail
        ?.sessionIds
      if (ids?.length && markSessionsOpenedInCache(queryClient, ids)) return
      queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
    }
    window.addEventListener('session-opened', handler)
    return () => window.removeEventListener('session-opened', handler)
  }, [queryClient])
}
