/**
 * Toggle the Graph tab of the left context panel from the command palette,
 * the `toggle_session_graph` shortcut and the header button (#84, #98).
 */

import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { chatQueryKeys } from '@/services/chat'
import { useUIStore } from '@/store/ui-store'
import type { Session, WorktreeSessions } from '@/types/chat'
import { getActiveSessionTarget } from './session-transfer'

/** The session the palette and shortcuts act on, from the query cache. */
export function getActiveSessionFromCache(
  queryClient: QueryClient
): Session | null {
  const target = getActiveSessionTarget()
  if (!target) return null
  return (
    queryClient
      .getQueryData<WorktreeSessions>(chatQueryKeys.sessions(target.worktreeId))
      ?.sessions.find(session => session.id === target.sessionId) ??
    queryClient.getQueryData<Session>(
      chatQueryKeys.session(target.sessionId)
    ) ??
    null
  )
}

/**
 * Open or close the left panel on its Graph tab (#84, #98). A session
 * without a graph link still opens the tab: it explains the link and offers
 * "Link to Graph…". Without a session there is nothing to show.
 */
export function toggleActiveSessionGraphPanel(queryClient: QueryClient): void {
  const { fileBrowserVisible, contextPanelTab, toggleContextPanel } =
    useUIStore.getState()
  // Closing needs no session: the panel may show a stale tab.
  const closing = fileBrowserVisible && contextPanelTab === 'graph'
  if (!closing && !getActiveSessionFromCache(queryClient)) {
    toast.info('Open a session to see its graph.')
    return
  }
  toggleContextPanel('graph')
}
