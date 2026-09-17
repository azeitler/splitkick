import { isBaseSession, type Project, type Worktree } from '@/types/projects'
import type { WorktreeSessions } from '@/types/chat'
import { getSessionActivityTimestamp } from './worktree-sort-utils'

export interface RecentWorktreeRow {
  project: Project
  worktree: Worktree
  sessions: WorktreeSessions
  lastActivityAt: number
  added: number
  removed: number
}

export function buildRecentWorktreeRows(
  projects: Project[],
  worktreesByProject: ReadonlyMap<string, Worktree[]>,
  sessionsByWorktree: ReadonlyMap<string, WorktreeSessions>
): RecentWorktreeRow[] {
  return projects
    .flatMap(project =>
      (worktreesByProject.get(project.id) ?? []).flatMap(worktree => {
        const sessions = sessionsByWorktree.get(worktree.id)
        if (!sessions || sessions.sessions.length === 0) return []

        const promptedSessions = sessions.sessions.filter(
          session =>
            session.last_message_at != null ||
            (session.message_count ?? session.messages.length) > 0
        )
        if (promptedSessions.length === 0) return []

        const lastActivityAt = promptedSessions.reduce(
          (latest, session) =>
            Math.max(latest, getSessionActivityTimestamp(session)),
          0
        )
        const uncommittedAdded = worktree.cached_uncommitted_added ?? 0
        const uncommittedRemoved = worktree.cached_uncommitted_removed ?? 0
        const added = isBaseSession(worktree)
          ? uncommittedAdded
          : (worktree.cached_branch_diff_added ?? 0) + uncommittedAdded
        const removed = isBaseSession(worktree)
          ? uncommittedRemoved
          : (worktree.cached_branch_diff_removed ?? 0) + uncommittedRemoved

        return [
          {
            project,
            worktree,
            sessions,
            lastActivityAt,
            added,
            removed,
          },
        ]
      })
    )
    .sort(
      (a, b) =>
        b.lastActivityAt - a.lastActivityAt ||
        b.worktree.created_at - a.worktree.created_at
    )
}
