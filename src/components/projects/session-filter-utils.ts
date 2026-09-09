import { fuzzySearchItems } from '@/lib/fuzzy-search'
import {
  sessionMatchesLabelFilter,
  type LabelFilter,
} from '@/lib/label-filter'
import type { LabelData, Session, WorktreeSessions } from '@/types/chat'

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

/** Everything the sidebar filters sessions by. */
export interface SessionFilterCriteria {
  /** Fuzzy-matched against the session name. */
  query: string
  /** Selected label names. Empty means "every label". */
  labelFilter: LabelFilter
  /**
   * Unsaved labels from the chat store, keyed by session id. A label the user
   * has just set is not written back until the next state save, so it has to
   * win over the persisted one.
   */
  sessionLabels: Record<string, LabelData>
}

/** True when neither the query nor the labels would narrow the list. */
export function isSessionFilterEmpty(criteria: SessionFilterCriteria): boolean {
  return !criteria.query.trim() && criteria.labelFilter.size === 0
}

/**
 * Sessions matching both the query and the label selection, in their original
 * order. See {@link filterSessionsByQuery} for why the order is kept.
 */
export function filterSessions(
  sessions: Session[],
  criteria: SessionFilterCriteria
): Session[] {
  if (isSessionFilterEmpty(criteria)) return sessions

  const byQuery = filterSessionsByQuery(sessions, criteria.query)
  if (criteria.labelFilter.size === 0) return byQuery

  return byQuery.filter(session =>
    sessionMatchesLabelFilter(
      session,
      criteria.labelFilter,
      criteria.sessionLabels[session.id]
    )
  )
}

/**
 * Worktrees that still hold at least one matching session. An empty filter
 * returns the input array unchanged.
 */
export function selectWorktreesMatchingFilters<T extends { id: string }>(
  worktrees: T[],
  sessionsByWorktreeId: Map<string, WorktreeSessions>,
  criteria: SessionFilterCriteria
): T[] {
  if (isSessionFilterEmpty(criteria)) return worktrees

  return worktrees.filter(worktree => {
    const sessions = sessionsByWorktreeId.get(worktree.id)?.sessions ?? []
    return filterSessions(sessions, criteria).length > 0
  })
}

/**
 * The labels carried by every session of the given worktrees, for the sidebar
 * chip row.
 */
export function collectSessionLabelSources(
  sessionsByWorktreeId: Map<string, WorktreeSessions>,
  sessionLabels: Record<string, LabelData>
): LabelData[][] {
  const sources: LabelData[][] = []
  for (const entry of sessionsByWorktreeId.values()) {
    for (const session of entry.sessions) {
      const label = sessionLabels[session.id] ?? session.label
      if (label) sources.push([label])
    }
  }
  return sources
}
