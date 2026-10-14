import type { AllSessionsEntry, LabelData, Session } from '@/types/chat'
import type { StarredSessionRef } from '@/store/projects-store'
import { getSessionActivityTimestamp } from '@/components/projects/worktree-sort-utils'
import { toMilliseconds } from '@/lib/relative-time'

/**
 * Lists with fewer items than this get no filter field. Shared by the Projects
 * and Recent sessions sections, so both show their filter at the same point.
 */
export const HOME_FILTER_MIN_ITEMS = 6

/** Shown in place of a blank session name, and matched under that word. */
const UNTITLED_SESSION_NAME = 'Untitled'

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

/**
 * Resolve stars into rows, in star order.
 *
 * A star resolves by session id alone, so it follows a session that was moved
 * to another workspace. Archived sessions and ones that no longer exist are
 * left out, but the stars themselves are never pruned: the all-sessions query
 * may not have settled on a slow start, and unarchiving a session should bring
 * its row straight back.
 */
export function resolveStarredSessions(
  stars: readonly StarredSessionRef[],
  entries: readonly AllSessionsEntry[]
): HomeSessionEntry[] {
  if (stars.length === 0) return []

  const byId = new Map<string, HomeSessionEntry>()
  for (const entry of entries) {
    for (const session of entry.sessions) {
      if (session.archived_at) continue
      byId.set(session.id, {
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

  const rows: HomeSessionEntry[] = []
  for (const star of stars) {
    const row = byId.get(star.sessionId)
    if (row) rows.push(row)
  }
  return rows
}

/**
 * Whether a Home session row matches the typed filter.
 *
 * A case-insensitive substring match, like the Projects filter, over what the
 * row shows: the session name, its project, its worktree and its label. The
 * list spans every project, so typing a project name narrows it to that
 * project's sessions.
 */
export function matchesSessionQuery(
  row: HomeSessionEntry,
  query: string,
  /** The label the row shows; the unsaved store label wins over the stored one. */
  label?: LabelData
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  return [
    row.session.name || UNTITLED_SESSION_NAME,
    row.projectName,
    row.worktreeName,
    label?.name,
  ].some(field => field?.toLowerCase().includes(needle))
}

/** A run of session rows under one day heading. */
export interface SessionDayGroup {
  label: 'Today' | 'Yesterday' | 'Earlier'
  rows: HomeSessionEntry[]
}

/**
 * Split rows, newest first, under Today, Yesterday and Earlier headings.
 *
 * Days are local calendar days, so a session from 23:50 is "Yesterday" ten
 * minutes after midnight. Empty groups are left out. `now` is injectable so
 * the tests stay deterministic.
 */
export function groupSessionsByDay(
  rows: readonly HomeSessionEntry[],
  now = Date.now()
): SessionDayGroup[] {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const todayStart = startOfToday.getTime()
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const yesterdayStart = startOfYesterday.getTime()

  const groups: SessionDayGroup[] = [
    { label: 'Today', rows: [] },
    { label: 'Yesterday', rows: [] },
    { label: 'Earlier', rows: [] },
  ]
  for (const row of rows) {
    const at = toMilliseconds(row.activityAt)
    const index = at >= todayStart ? 0 : at >= yesterdayStart ? 1 : 2
    groups[index]?.rows.push(row)
  }
  return groups.filter(group => group.rows.length > 0)
}
