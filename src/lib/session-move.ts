import { navigateToSession } from '@/lib/navigate-to-session'
import { queryClient } from '@/lib/query-client'
import { invoke } from '@/lib/transport'
import {
  chatQueryKeys,
  cleanupSessionTerminalForRemovedSession,
} from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'

/** Payload of the backend's `session:moved` event (issue #67). */
export interface SessionMovedEvent {
  sessionId: string
  sourceWorktreeId: string
  sourceProjectId: string
  targetWorktreeId: string
  targetProjectId: string
}

export interface MoveSessionResult {
  sessionId: string
  sourceWorktreeId: string
  targetWorktreeId: string
  targetProjectId: string
  status: 'moved' | 'scheduled'
}

/**
 * Move a session to another worktree, in this or another project, and open it
 * there. The backend refuses a running session and one with queued messages.
 */
export async function moveSession(
  sessionId: string,
  targetWorktreeId: string
): Promise<MoveSessionResult> {
  const result = await invoke<MoveSessionResult>('move_session', {
    sessionId,
    targetWorktreeId,
  })
  // ChatWindow falls back to the first tab when the active session is not in
  // the cached list, and the next message would go to the wrong session.
  await queryClient.invalidateQueries({
    queryKey: chatQueryKeys.sessions(result.targetWorktreeId),
    refetchType: 'all',
  })
  navigateToSession({
    projectId: result.targetProjectId,
    worktreeId: result.targetWorktreeId,
    sessionId,
  })
  return result
}

/**
 * Keep the client state right after a move, from the UI or from MCP.
 *
 * The session keeps its id, so state keyed by session id follows it by itself
 * (stars, labels, unread). This fixes what also names the old worktree or
 * project: the session → worktree map, the source's active tab, the
 * project's last-opened entry and its pin. A session terminal runs in the old
 * folder, so it is closed.
 */
export function handleSessionMoved(event: SessionMovedEvent): void {
  const {
    sessionId,
    sourceWorktreeId,
    sourceProjectId,
    targetWorktreeId,
    targetProjectId,
  } = event

  useChatStore.setState(state => {
    const { [sourceWorktreeId]: activeInSource, ...otherActive } =
      state.activeSessionIds
    const lastOpened = state.lastOpenedPerProject[sourceProjectId]
    const { [sourceProjectId]: _source, ...otherLastOpened } =
      state.lastOpenedPerProject
    return {
      sessionWorktreeMap: {
        ...state.sessionWorktreeMap,
        [sessionId]: targetWorktreeId,
      },
      activeSessionIds:
        activeInSource === sessionId ? otherActive : state.activeSessionIds,
      lastOpenedPerProject:
        lastOpened?.sessionId !== sessionId
          ? state.lastOpenedPerProject
          : sourceProjectId === targetProjectId
            ? {
                ...state.lastOpenedPerProject,
                [sourceProjectId]: {
                  worktreeId: targetWorktreeId,
                  sessionId,
                },
              }
            : otherLastOpened,
    }
  })

  const projects = useProjectsStore.getState()
  const pinned = (
    projects.projectCanvasSettings[sourceProjectId]?.pinnedSessions ?? []
  ).some(pin => pin.sessionId === sessionId)
  if (pinned) {
    projects.unpinSessionFromProject(sourceProjectId, sessionId)
    useProjectsStore
      .getState()
      .pinSessionToProject(targetProjectId, sessionId, targetWorktreeId)
  }

  cleanupSessionTerminalForRemovedSession(sourceWorktreeId, sessionId)

  queryClient.invalidateQueries({
    queryKey: chatQueryKeys.sessions(sourceWorktreeId),
  })
  queryClient.invalidateQueries({
    queryKey: chatQueryKeys.sessions(targetWorktreeId),
  })
  queryClient.invalidateQueries({ queryKey: chatQueryKeys.session(sessionId) })
  queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
}
