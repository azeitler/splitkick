import { toast } from 'sonner'
import { flushUIState } from '@/lib/ui-state-flush'
import { logger } from '@/lib/logger'
import { queryClient } from '@/lib/query-client'
import { isWsDisconnectError } from '@/lib/query-error'
import { useProjectsStore } from '@/store/projects-store'

/** Unwrap a Tauri rejection (a plain string) or an Error into a message. */
function describeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unknown error occurred'
}

/**
 * Persist a pin/star change that the store already applied. On failure, undo
 * it and tell the user, so the screen never shows a pin that is not on disk.
 *
 * `revert` returns false when a newer toggle already owns the value. That
 * toggle reports its own outcome, so this stale failure stays quiet rather
 * than reverting the newer intent or naming the wrong direction.
 */
async function persistOrRevert(
  action: string,
  revert: () => boolean
): Promise<void> {
  try {
    await flushUIState()
  } catch (error) {
    if (!revert()) return
    // The web client reloads from disk after a drop, so a toast is noise.
    if (isWsDisconnectError(error)) return
    logger.error(`Failed to ${action}`, { error })
    toast.error(`Failed to ${action}`, { description: describeError(error) })
  }
}

function isPinnedNow(projectId: string, sessionId: string): boolean {
  return (
    useProjectsStore.getState().projectCanvasSettings[projectId]
      ?.pinnedSessions ?? []
  ).some(pin => pin.sessionId === sessionId)
}

function isStarredNow(sessionId: string): boolean {
  return useProjectsStore
    .getState()
    .starredSessions.some(star => star.sessionId === sessionId)
}

interface ToggleArgs {
  projectId: string
  sessionId: string
  worktreeId: string
}

/** Pin or unpin a session for one project, and persist the result. */
export async function togglePinnedSession({
  projectId,
  sessionId,
  worktreeId,
  isPinned,
}: ToggleArgs & { isPinned: boolean }): Promise<void> {
  const store = useProjectsStore.getState()

  if (isPinned) {
    store.unpinSessionFromProject(projectId, sessionId)
    await persistOrRevert('unpin session', () => {
      if (isPinnedNow(projectId, sessionId)) return false
      useProjectsStore
        .getState()
        .pinSessionToProject(projectId, sessionId, worktreeId)
      return true
    })
    return
  }

  store.pinSessionToProject(projectId, sessionId, worktreeId)
  await persistOrRevert('pin session', () => {
    if (!isPinnedNow(projectId, sessionId)) return false
    useProjectsStore.getState().unpinSessionFromProject(projectId, sessionId)
    return true
  })
}

/** Star or unstar a session globally, and persist the result. */
export async function toggleStarredSession({
  projectId,
  sessionId,
  worktreeId,
  isStarred,
}: ToggleArgs & { isStarred: boolean }): Promise<void> {
  const store = useProjectsStore.getState()

  if (isStarred) {
    store.unstarSession(sessionId)
    await persistOrRevert('unstar session', () => {
      if (isStarredNow(sessionId)) return false
      useProjectsStore
        .getState()
        .starSession({ projectId, worktreeId, sessionId })
      return true
    })
    return
  }

  store.starSession({ projectId, worktreeId, sessionId })
  // The Starred section and Home resolve stars against the all-sessions
  // cache, which never refreshes on focus. A session created since the last
  // fetch (here, by an agent, or by another Jean) is not in it, so its star
  // would never show. Refetch.
  void queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
  await persistOrRevert('star session', () => {
    if (!isStarredNow(sessionId)) return false
    useProjectsStore.getState().unstarSession(sessionId)
    return true
  })
}
