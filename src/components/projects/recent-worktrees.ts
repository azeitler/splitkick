import { isBaseSession, type Project, type Worktree } from '@/types/projects'
import type { Session, WorktreeSessions } from '@/types/chat'
import { getSessionActivityTimestamp } from './worktree-sort-utils'

export interface RecentWorktreeRow {
  project: Project
  worktree: Worktree
  session: Session
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
            !session.archived_at &&
            (session.last_message_at != null ||
              (session.message_count ?? session.messages.length) > 0)
        )
        if (promptedSessions.length === 0) return []

        const session = promptedSessions.reduce((latest, candidate) =>
          getSessionActivityTimestamp(candidate) >
          getSessionActivityTimestamp(latest)
            ? candidate
            : latest
        )
        const lastActivityAt = getSessionActivityTimestamp(session)
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
            session,
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
