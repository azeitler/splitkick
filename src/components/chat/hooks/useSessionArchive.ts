import { useCallback } from 'react'
import { useArchiveSession, useCloseSession } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import type { RemovalBehavior } from '@/types/preferences'

interface UseSessionArchiveParams {
  worktreeId: string
  worktreePath: string
  sessions: Session[] | undefined
  removalBehavior?: RemovalBehavior
}

/**
 * Provides archive and delete handlers for sessions.
 * When closing the last session, navigates to canvas instead of deleting the worktree.
 * The Rust backend automatically creates a fresh default session when the last one is removed.
 *
 * - handleArchiveSession: always archives (context menu "Archive Session")
 * - handleDeleteSession: respects removalBehavior preference (context menu "Delete Session")
 *   - 'archive' (default): archives session
 *   - 'delete': permanently deletes session
 */
export function useSessionArchive({
  worktreeId,
  worktreePath,
  sessions,
  removalBehavior = 'archive',
}: UseSessionArchiveParams) {
  const archiveSession = useArchiveSession()
  const closeSession = useCloseSession()

  const navigateToCanvas = useCallback(() => {
    useChatStore.getState().setViewingCanvasTab(worktreeId, true)
  }, [worktreeId])

  // Always archives — used by context menu "Archive Session"
  const handleArchiveSession = useCallback(
    (sessionId: string) => {
      const activeSessions = sessions?.filter(s => !s.archived_at) ?? []
      const isLastSession = activeSessions.length <= 1

      archiveSession.mutate({
        worktreeId,
        worktreePath,
        sessionId,
      })

      if (isLastSession) {
        navigateToCanvas()
      }
    },
    [sessions, worktreeId, worktreePath, archiveSession, navigateToCanvas]
  )

  // Respects removalBehavior preference — used by context menu "Delete Session"
  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      const activeSessions = sessions?.filter(s => !s.archived_at) ?? []
      const isLastSession = activeSessions.length <= 1

      if (removalBehavior === 'delete') {
        closeSession.mutate({
          worktreeId,
          worktreePath,
          sessionId,
        })
      } else {
        archiveSession.mutate({
          worktreeId,
          worktreePath,
          sessionId,
        })
      }

      if (isLastSession) {
        navigateToCanvas()
      }
    },
    [
      sessions,
      worktreeId,
      worktreePath,
      removalBehavior,
      closeSession,
      archiveSession,
      navigateToCanvas,
    ]
  )

  return { handleArchiveSession, handleDeleteSession }
}
