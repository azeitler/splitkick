import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke, listen } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type { ActivityEvent } from '@/types/activity'

export const activityQueryKeys = {
  recent: (limit: number) => ['recent-activity', limit] as const,
}

/** Rows the Home feed asks for by default. */
export const DEFAULT_ACTIVITY_LIMIT = 30

/**
 * The newest activity records, newest first.
 *
 * The backend appends a record when the event happens, so this is real history
 * rather than a guess made from the current state of a session. The query is
 * refreshed by the `activity:appended` event, not by polling.
 */
export function useRecentActivity(
  limit = DEFAULT_ACTIVITY_LIMIT,
  enabled = true
) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    let dispose: (() => void) | undefined
    let cancelled = false

    listen<ActivityEvent>('activity:appended', () => {
      queryClient.invalidateQueries({ queryKey: ['recent-activity'] })
    }).then(unlisten => {
      if (cancelled) unlisten()
      else dispose = unlisten
    })

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [enabled, queryClient])

  return useQuery({
    queryKey: activityQueryKeys.recent(limit),
    queryFn: async (): Promise<ActivityEvent[]> => {
      try {
        return await invoke<ActivityEvent[]>('list_recent_activity', { limit })
      } catch (error) {
        logger.error('Failed to load recent activity', { error })
        return []
      }
    },
    enabled,
    staleTime: 1000 * 30,
  })
}
