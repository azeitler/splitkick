import { useCallback } from 'react'
import {
  useArchiveWorktree,
  useCloseBaseSessionClean,
  useCloseBaseSessionArchive,
  useDeleteWorktree,
} from '@/services/projects'
import { useArchiveSession, useCloseSession } from '@/services/chat'
import { isBaseSession, type Worktree, type Project } from '@/types/projects'
import type { Session } from '@/types/chat'
import type { RemovalBehavior } from '@/types/preferences'

interface UseSessionArchiveParams {
  worktreeId: string
  worktreePath: string
  sessions: Session[] | undefined
  worktree: Worktree | null | undefined
  project: Project | null | undefined
  removalBehavior?: RemovalBehavior
}

/**
 * Provides archive and delete handlers for sessions.
 * Handles the "last session" case by archiving/deleting the worktree.
 *
 * - handleArchiveSession: always archives (context menu "Archive Session")
 * - handleDeleteSession: respects removalBehavior preference (context menu "Delete Session")
 *   - 'archive' (default): archives session/worktree
 *   - 'delete': permanently deletes session/worktree
 */
export function useSessionArchive({
  worktreeId,
  worktreePath,
  sessions,
  worktree,
  project,
  removalBehavior = 'archive',
}: UseSessionArchiveParams) {
  const archiveSession = useArchiveSession()
  const closeSession = useCloseSession()
  const archiveWorktree = useArchiveWorktree()
  const deleteWorktree = useDeleteWorktree()
  const closeBaseSessionClean = useCloseBaseSessionClean()
  const closeBaseSessionArchive = useCloseBaseSessionArchive()

  // Always archives — used by context menu "Archive Session"
  const handleArchiveSession = useCallback(
    (sessionId: string) => {
      const activeSessions = sessions?.filter(s => !s.archived_at) ?? []

      if (activeSessions.length <= 1 && worktree && project) {
        if (isBaseSession(worktree)) {
          closeBaseSessionArchive.mutate({
            worktreeId,
            projectId: project.id,
          })
        } else {
          archiveWorktree.mutate({
            worktreeId,
            projectId: project.id,
          })
        }
      } else {
        archiveSession.mutate({
          worktreeId,
          worktreePath,
          sessionId,
        })
      }
    },
    [
      sessions,
      worktree,
      project,
      worktreeId,
      worktreePath,
      archiveSession,
      archiveWorktree,
      closeBaseSessionArchive,
    ]
  )

  // Respects removalBehavior preference — used by context menu "Delete Session"
  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      const activeSessions = sessions?.filter(s => !s.archived_at) ?? []

      if (activeSessions.length <= 1 && worktree && project) {
        if (isBaseSession(worktree)) {
          if (removalBehavior === 'delete') {
            closeBaseSessionClean.mutate({
              worktreeId,
              projectId: project.id,
            })
          } else {
            closeBaseSessionArchive.mutate({
              worktreeId,
              projectId: project.id,
            })
          }
        } else if (removalBehavior === 'delete') {
          deleteWorktree.mutate({
            worktreeId,
            projectId: project.id,
          })
        } else {
          archiveWorktree.mutate({
            worktreeId,
            projectId: project.id,
          })
        }
      } else if (removalBehavior === 'delete') {
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
    },
    [
      sessions,
      worktree,
      project,
      worktreeId,
      worktreePath,
      removalBehavior,
      closeSession,
      archiveSession,
      archiveWorktree,
      deleteWorktree,
      closeBaseSessionClean,
      closeBaseSessionArchive,
    ]
  )

  return { handleArchiveSession, handleDeleteSession }
}
