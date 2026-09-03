import type { Session } from '@/types/chat'
import { isBaseSession, type Worktree } from '@/types/projects'
import type { PinnedSessionRef } from '@/store/projects-store'

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
