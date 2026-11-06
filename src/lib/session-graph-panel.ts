/**
 * Toggle the session graph panel from the command palette and the
 * `toggle_session_graph` shortcut (issue #84). The header button uses the
 * store directly: it only shows when the session has a panel.
 */

import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sessionHasGraphPanel } from '@/components/graphs/SessionGraphPanel'
import { isMobileViewport } from '@/hooks/use-mobile'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { openLinkToGraph } from '@/lib/link-to-graph'
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
 * Show or hide the graph panel of the active session. A session without a
 * graph link gets an explanation instead of an empty panel; a phone gets a
 * note that the panel is desktop-only.
 */
export function toggleActiveSessionGraphPanel(queryClient: QueryClient): void {
  const session = getActiveSessionFromCache(queryClient)
  if (!session) {
    toast.info('Open a session to see its graph panel.')
    return
  }
  if (!sessionHasGraphPanel(session)) {
    toast.info('This session does not serve a graph node yet.', {
      description:
        'Link it with "Link to Graph…" (session menu or command palette), or let the session link itself with the set_serves MCP tool.',
      action: {
        label: 'Link to Graph…',
        onClick: () => openLinkToGraph(session),
      },
    })
    return
  }
  if (isMobileViewport()) {
    toast.info('The graph panel is only available on desktop.')
    return
  }
  useChatStore.getState().toggleGraphPanel()
}
