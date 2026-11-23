import { useMemo } from 'react'
import { useAllArchivedSessions } from '@/services/chat'
import { useArchivedWorktrees } from '@/services/projects'

/**
 * Archived worktrees plus archived sessions — the Archived view's "All"
 * count — for one project, or for all when `projectId` is undefined.
 *
 * Reads the two lists the Archived view loads. Both are single app-wide
 * queries, shared by every caller, so a sidebar with many projects still
 * sends one request each.
 */
export function useArchivedCount(projectId?: string): number {
  const { data: worktrees } = useArchivedWorktrees()
  const { data: sessions } = useAllArchivedSessions()
  return useMemo(() => {
    if (projectId === undefined) {
      return (worktrees?.length ?? 0) + (sessions?.length ?? 0)
    }
    let count = 0
    for (const worktree of worktrees ?? []) {
      if (worktree.project_id === projectId) count++
    }
    for (const entry of sessions ?? []) {
      if (entry.project_id === projectId) count++
    }
    return count
  }, [worktrees, sessions, projectId])
}
