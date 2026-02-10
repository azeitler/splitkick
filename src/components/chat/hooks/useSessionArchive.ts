import { useCallback } from 'react'
import {
  useArchiveWorktree,
  useCloseBaseSessionClean,
} from '@/services/projects'
import { useArchiveSession, useCloseSession } from '@/services/chat'
import { isBaseSession, type Worktree, type Project } from '@/types/projects'
import type { Session } from '@/types/chat'

interface UseSessionArchiveParams {
  worktreeId: string
  worktreePath: string
  sessions: Session[] | undefined
  worktree: Worktree | null | undefined
  project: Project | null | undefined
}

/**
 * Provides archive and delete handlers for sessions.
 * Handles the "last session" case by archiving the worktree instead.
 */
export function useSessionArchive({
  worktreeId,
  worktreePath,
  sessions,
  worktree,
  project,
}: UseSessionArchiveParams) {
  const archiveSession = useArchiveSession()
  const closeSession = useCloseSession()
  const archiveWorktree = useArchiveWorktree()
  const closeBaseSessionClean = useCloseBaseSessionClean()

  const handleArchiveSession = useCallback(
    (sessionId: string) => {
      const activeSessions = sessions?.filter(s => !s.archived_at) ?? []

      if (activeSessions.length <= 1 && worktree && project) {
        if (isBaseSession(worktree)) {
          closeBaseSessionClean.mutate({
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
      closeBaseSessionClean,
    ]
  )

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      const activeSessions = sessions?.filter(s => !s.archived_at) ?? []

      if (activeSessions.length <= 1 && worktree && project) {
        if (isBaseSession(worktree)) {
          closeBaseSessionClean.mutate({
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
        closeSession.mutate({
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
      closeSession,
      archiveWorktree,
      closeBaseSessionClean,
    ]
  )

  return { handleArchiveSession, handleDeleteSession }
}
