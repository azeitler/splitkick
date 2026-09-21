import { useCallback } from 'react'
import { useArchiveSession, useCloseSession } from '@/services/chat'
import type { RemovalBehavior } from '@/types/preferences'

/** The session a removal acts on. Passed per call, so one hook serves many worktrees. */
export interface SessionTarget {
  worktreeId: string
  worktreePath: string
  sessionId: string
}

interface UseSessionArchiveParams {
  worktreeId: string
  worktreePath: string
  removalBehavior?: RemovalBehavior
}

/**
 * Archive and delete handlers that take their target per call.
 *
 * Use this where the rows come from more than one worktree (the pinned
 * section). Where every row belongs to the same worktree, `useSessionArchive`
 * below binds the worktree once and gives you plain `(sessionId) => void`
 * handlers.
 *
 * - archive: always archives (context menu "Archive Session")
 * - remove: respects removalBehavior preference (context menu "Delete Session")
 *   - 'archive' (default): archives session
 *   - 'delete': permanently deletes session
 *
 * When the last non-archived session is removed, the backend leaves the
 * worktree empty and the modal shows its empty state instead of navigating
 * away or auto-creating a fallback "Session 1".
 */
export function useSessionRemoval(removalBehavior: RemovalBehavior = 'archive') {
  const archiveSession = useArchiveSession()
  const closeSession = useCloseSession()

  const archive = useCallback(
    (target: SessionTarget) => archiveSession.mutate(target),
    [archiveSession]
  )

  const remove = useCallback(
    (target: SessionTarget) => {
      if (removalBehavior === 'delete') {
        closeSession.mutate(target)
      } else {
        archiveSession.mutate(target)
      }
    },
    [removalBehavior, closeSession, archiveSession]
  )

  return { archive, remove }
}

/**
 * Worktree-bound wrapper over `useSessionRemoval`, for hosts whose sessions all
 * live in one worktree.
 *
 * - handleArchiveSession: always archives (context menu "Archive Session")
 * - handleDeleteSession: respects removalBehavior preference (context menu "Delete Session")
 */
export function useSessionArchive({
  worktreeId,
  worktreePath,
  removalBehavior = 'archive',
}: UseSessionArchiveParams) {
  const { archive, remove } = useSessionRemoval(removalBehavior)

  const handleArchiveSession = useCallback(
    (sessionId: string) => archive({ worktreeId, worktreePath, sessionId }),
    [archive, worktreeId, worktreePath]
  )

  const handleDeleteSession = useCallback(
    (sessionId: string) => remove({ worktreeId, worktreePath, sessionId }),
    [remove, worktreeId, worktreePath]
  )

  return { handleArchiveSession, handleDeleteSession }
}
