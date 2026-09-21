import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Refetch the all-sessions cache whenever a session is opened.
 *
 * Opening a session stamps its `last_opened_at`, which is what the unread
 * count, the phone's History tab and its Unread list read. Mounted by the
 * unread bell on the desktop and by the phone's tab shell, which has no bell.
 */
export function useRefreshSessionsOnOpen(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const handler = () =>
      queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
    window.addEventListener('session-opened', handler)
    return () => window.removeEventListener('session-opened', handler)
  }, [queryClient])
}
