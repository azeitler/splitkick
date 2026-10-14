import { useMemo } from 'react'
import { useAllSessions } from '@/services/chat'
import { countUnreadSessions } from '@/lib/dock'

/** Returns the number of unread sessions across all projects */
export function useUnreadCount(): number {
  const { data: allSessions } = useAllSessions(true)
  return useMemo(() => countUnreadSessions(allSessions), [allSessions])
}
