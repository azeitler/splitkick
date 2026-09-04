import { fuzzySearchItems } from '@/lib/fuzzy-search'
import type { Session, WorktreeSessions } from '@/types/chat'

/** Shown in place of a blank session name, and searchable under that word. */
const UNTITLED_SESSION_NAME = 'Untitled'

/**
 * Sessions whose name fuzzy-matches `query`, in their original order.
 *
 * Order is preserved on purpose: the sidebar re-groups the result with
 * `groupCardsByStatus()`, which sorts again, so Fuse's relevance ranking would
 * be thrown away anyway.
 *
 * A blank query returns the input array unchanged — note that
 * `fuzzySearchItems` defaults to `limit = 15`, so the limit must always be
 * passed explicitly or long session lists would be silently truncated.
 */
export function filterSessionsByQuery(
  sessions: Session[],
  query: string
): Session[] {
  const trimmed = query.trim()
  if (!trimmed || sessions.length === 0) return sessions

  const matches = fuzzySearchItems(
    sessions.map(session => ({
      id: session.id,
      name: session.name || UNTITLED_SESSION_NAME,
    })),
    trimmed,
    sessions.length
  )
  const matchedIds = new Set(matches.map(match => match.id))
  return sessions.filter(session => matchedIds.has(session.id))
}

/**
 * Worktrees that still hold at least one matching session. A blank query
 * returns the input array unchanged.
 *
 * Worktrees missing from `sessionsByWorktreeId` (pending ones, or ones whose
 * session query has not resolved yet) hold nothing to match, so they drop out
 * while a filter is active.
 */
export function selectWorktreesMatchingQuery<T extends { id: string }>(
  worktrees: T[],
  sessionsByWorktreeId: Map<string, WorktreeSessions>,
  query: string
): T[] {
  const trimmed = query.trim()
  if (!trimmed) return worktrees

  return worktrees.filter(worktree => {
    const sessions = sessionsByWorktreeId.get(worktree.id)?.sessions ?? []
    return filterSessionsByQuery(sessions, trimmed).length > 0
  })
}
