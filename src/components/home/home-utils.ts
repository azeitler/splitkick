import type { AllSessionsEntry, LabelData, Session } from '@/types/chat'
import { getSessionActivityTimestamp } from '@/components/projects/worktree-sort-utils'

/** One session, with the project and worktree it belongs to. */
export interface HomeSessionEntry {
  session: Session
  projectId: string
  projectName: string
  worktreeId: string
  worktreeName: string
  worktreePath: string
  activityAt: number
}

/**
 * Every non-archived session of every project, newest activity first.
 *
 * `list_all_sessions` already carries the project and worktree of each session,
 * so Home does not need its own backend query.
 */
export function flattenAllSessions(
  entries: readonly AllSessionsEntry[]
): HomeSessionEntry[] {
  const rows: HomeSessionEntry[] = []

  for (const entry of entries) {
    for (const session of entry.sessions) {
      if (session.archived_at) continue
      rows.push({
        session,
        projectId: entry.project_id,
        projectName: entry.project_name,
        worktreeId: entry.worktree_id,
        worktreeName: entry.worktree_name,
        worktreePath: entry.worktree_path,
        activityAt: getSessionActivityTimestamp(session),
      })
    }
  }

  return rows.sort((a, b) => b.activityAt - a.activityAt)
}

/**
 * The label of a session: the unsaved one from the chat store when there is
 * one, otherwise the persisted one.
 *
 * The store wins because a label the user just set is not written back until
 * the next state save.
 */
export function resolveSessionLabel(
  session: Session,
  sessionLabels: Record<string, LabelData>
): LabelData | undefined {
  return sessionLabels[session.id] ?? session.label
}
