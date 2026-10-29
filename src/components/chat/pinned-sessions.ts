import type { Session } from '@/types/chat'
import { isBaseSession, type Worktree } from '@/types/projects'
import type {
  PinnedSessionRef,
  StarredSessionRef,
} from '@/store/projects-store'
import { getSessionActivityTimestamp } from '@/components/projects/worktree-sort-utils'

/** A pinned session resolved against the project's live worktrees and sessions. */
export interface PinnedSessionRow {
  sessionId: string
  worktreeId: string
  worktreePath: string
  /** Display name of the owning worktree ("Base Session" for the base worktree). */
  worktreeName: string
  session: Session
}

/**
 * Resolve stored pins into renderable rows.
 *
 * A pin is dropped when either its worktree or its session no longer resolves.
 * That single filter covers every staleness case: `get_sessions` already hides
 * archived sessions, deleted sessions leave the query, and a removed worktree is
 * absent from the worktree list. Pins are never pruned from storage — a session
 * query that has not settled yet would otherwise delete valid pins on a slow
 * start, and unarchiving a session brings its row straight back.
 *
 * `getSessions` is a callback rather than a Map because the two call sites hold
 * different map value types (`{ sessions, isLoading }` on the canvas,
 * `WorktreeSessions` in the sidebar).
 */
export function resolvePinnedSessionRows(
  pins: readonly PinnedSessionRef[] | undefined,
  getSessions: (worktreeId: string) => readonly Session[] | undefined,
  worktrees: readonly Worktree[]
): PinnedSessionRow[] {
  if (!pins?.length) return []

  const worktreeById = new Map(
    worktrees.map(worktree => [worktree.id, worktree])
  )
  const rows: PinnedSessionRow[] = []

  for (const pin of pins) {
    const worktree = worktreeById.get(pin.worktreeId)
    if (!worktree) continue

    const session = getSessions(pin.worktreeId)?.find(
      candidate => candidate.id === pin.sessionId
    )
    if (!session) continue

    rows.push({
      sessionId: pin.sessionId,
      worktreeId: pin.worktreeId,
      worktreePath: worktree.path,
      worktreeName: isBaseSession(worktree) ? 'Base Session' : worktree.name,
      session,
    })
  }

  return rows
}

/** A row of the project's top section: a pin, a star, or both. */
export interface ProjectShortcutRow extends PinnedSessionRow {
  isPinned: boolean
  isStarred: boolean
}

/** What the section holds; drives its label and icon. */
export type ProjectShortcutKind = 'pinned' | 'starred' | 'both'

/**
 * Resolve the project's top section: its pins and the stars whose `projectId`
 * matches, one row per session, most recent activity first.
 *
 * `kind` is `getProjectShortcutKind(rows)`. Stars resolve like pins (see `resolvePinnedSessionRows`), so a star
 * whose session has not loaded yet is hidden, never pruned.
 */
export function resolveProjectShortcutRows(
  pins: readonly PinnedSessionRef[] | undefined,
  stars: readonly StarredSessionRef[],
  projectId: string,
  getSessions: (worktreeId: string) => readonly Session[] | undefined,
  worktrees: readonly Worktree[]
): { rows: ProjectShortcutRow[]; kind: ProjectShortcutKind | null } {
  const byId = new Map<string, ProjectShortcutRow>()

  for (const row of resolvePinnedSessionRows(pins, getSessions, worktrees)) {
    byId.set(row.sessionId, { ...row, isPinned: true, isStarred: false })
  }

  const projectStars = stars.filter(star => star.projectId === projectId)
  for (const row of resolvePinnedSessionRows(
    projectStars,
    getSessions,
    worktrees
  )) {
    const pinned = byId.get(row.sessionId)
    if (pinned) pinned.isStarred = true
    else byId.set(row.sessionId, { ...row, isPinned: false, isStarred: true })
  }

  // Array sort is stable, so ties keep pins first, then stars, in their order.
  const rows = [...byId.values()].sort(
    (a, b) =>
      getSessionActivityTimestamp(b.session) -
      getSessionActivityTimestamp(a.session)
  )

  return { rows, kind: getProjectShortcutKind(rows) }
}

/**
 * The mix of rows: `both` as soon as any row is pinned and any row is starred
 * (a row that is both counts towards both), `null` without rows.
 */
export function getProjectShortcutKind(
  rows: readonly Pick<ProjectShortcutRow, 'isPinned' | 'isStarred'>[]
): ProjectShortcutKind | null {
  const hasPin = rows.some(row => row.isPinned)
  const hasStar = rows.some(row => row.isStarred)
  if (hasPin && hasStar) return 'both'
  if (hasPin) return 'pinned'
  if (hasStar) return 'starred'
  return null
}
