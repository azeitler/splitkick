import {
  isBaseSession,
  type SessionSortMode,
  type SortDirection,
  type Worktree,
  type WorktreeSortMode,
} from '@/types/projects'
import type { Session } from '@/types/chat'
import { toMilliseconds } from '@/lib/relative-time'

export type {
  SessionSortMode,
  SortDirection,
  WorktreeSortMode,
} from '@/types/projects'

export function getSessionActivityTimestamp(session: Session): number {
  return session.last_message_at ?? session.updated_at ?? session.created_at
}

export function getWorktreeLastActivity(
  sessions: Session[],
  fallbackTimestamp: number
): number {
  return sessions.reduce(
    (latest, session) => Math.max(latest, getSessionActivityTimestamp(session)),
    fallbackTimestamp
  )
}

/**
 * Rows with no interaction for this long render faded in the project tree.
 *
 * Two days, which lines up with the age label: `formatRelativeTime` floors to
 * whole days, so everything reading `2d ago` or older is faded and everything
 * reading `1d ago` or newer is not.
 */
export const STALE_ACTIVITY_MS = 48 * 60 * 60 * 1000

/**
 * True when the last interaction is older than {@link STALE_ACTIVITY_MS}.
 *
 * `now` is injectable so the tests stay deterministic.
 */
export function isStaleActivity(timestamp: number, now = Date.now()): boolean {
  return now - toMilliseconds(timestamp) > STALE_ACTIVITY_MS
}

/**
 * Rows touched more recently than this show no "last active" label. Under an
 * hour the age carries no information the status indicator does not already
 * give, and a label on every row is noise.
 */
export const LAST_ACTIVE_LABEL_MIN_AGE_MS = 60 * 60 * 1000

/**
 * True once a row is old enough to be worth labelling with its age.
 *
 * `now` is injectable so the tests stay deterministic.
 */
export function shouldShowLastActive(
  timestamp: number,
  now = Date.now()
): boolean {
  return now - toMilliseconds(timestamp) >= LAST_ACTIVE_LABEL_MIN_AGE_MS
}

/**
 * Whether a project-tree row should render faded.
 *
 * Age is the only test. Deliberately no status gate: a session's status is
 * derived from persisted state, so one abandoned mid-question or mid-plan
 * reports `waiting` or `plan_approval` forever and would never fade, sitting
 * bright beside equally dead idle rows. Live work needs no gate either — a
 * running session's activity timestamp is its current run's start, so it can
 * never read as stale. The row you are on stays at full weight regardless.
 */
export function shouldFadeRow(
  activityAt: number,
  isCurrent: boolean,
  now = Date.now()
): boolean {
  return !isCurrent && isStaleActivity(activityAt, now)
}

export function getWorktreeSortValue(
  worktree: Worktree,
  latestActivityAt: number,
  sortMode: WorktreeSortMode
): number {
  if (sortMode === 'manual') {
    return worktree.order
  }

  if (sortMode === 'created') {
    return worktree.created_at
  }

  return Math.max(latestActivityAt, worktree.created_at)
}

export function compareWorktreesForCanvasSort(
  a: Worktree,
  b: Worktree,
  latestActivityByWorktreeId: ReadonlyMap<string, number>,
  sortMode: WorktreeSortMode
): number {
  const aIsBase = isBaseSession(a)
  const bIsBase = isBaseSession(b)
  if (aIsBase && !bIsBase) return -1
  if (!aIsBase && bIsBase) return 1

  if (sortMode === 'manual') {
    const orderDiff = a.order - b.order
    if (orderDiff !== 0) return orderDiff

    const createdDiff = b.created_at - a.created_at
    if (createdDiff !== 0) return createdDiff

    return a.id.localeCompare(b.id)
  }

  const sortDiff =
    getWorktreeSortValue(
      b,
      latestActivityByWorktreeId.get(b.id) ?? b.created_at,
      sortMode
    ) -
    getWorktreeSortValue(
      a,
      latestActivityByWorktreeId.get(a.id) ?? a.created_at,
      sortMode
    )
  if (sortDiff !== 0) return sortDiff

  return b.created_at - a.created_at
}

/**
 * The direction a sort mode starts in when it is picked: newest activity
 * first, titles A to Z. `default` has no direction; `asc` is returned only so
 * the value is never undefined.
 */
export function defaultSessionSortDirection(
  mode: SessionSortMode
): SortDirection {
  return mode === 'last_activity' ? 'desc' : 'asc'
}

/** Case-insensitive, with numeric runs compared as numbers: "2" before "10". */
const titleCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

function compareTitles(a: Session, b: Session): number {
  return titleCollator.compare(a.name ?? '', b.name ?? '')
}

function compareActivity(a: Session, b: Session): number {
  return (
    toMilliseconds(getSessionActivityTimestamp(a)) -
    toMilliseconds(getSessionActivityTimestamp(b))
  )
}

/**
 * Order two sessions by a non-default sort mode.
 *
 * Ties fall through to the other key and then to the id, so equal rows keep a
 * stable order instead of swapping on every render. Timestamps are normalised,
 * because older records store seconds and newer ones milliseconds.
 */
export function compareSessionsForSort(
  a: Session,
  b: Session,
  mode: Exclude<SessionSortMode, 'default'>,
  direction: SortDirection
): number {
  const sign = direction === 'asc' ? 1 : -1
  const primary = mode === 'title' ? compareTitles(a, b) : compareActivity(a, b)
  if (primary !== 0) return primary * sign

  const secondary =
    mode === 'title' ? compareActivity(b, a) : compareTitles(a, b)
  if (secondary !== 0) return secondary

  return a.id.localeCompare(b.id)
}

/**
 * Re-order the cards inside each status group.
 *
 * Grouping itself is untouched, and so is the order of the groups. `default`
 * returns the input as it is, so the order the groups already produce stays
 * exactly what it was before sorting existed.
 */
export function sortSessionGroups<
  T extends { cards: readonly { session: Session }[] },
>(groups: T[], mode: SessionSortMode, direction: SortDirection): T[] {
  if (mode === 'default') return groups

  return groups.map(group => ({
    ...group,
    cards: [...group.cards].sort((a, b) =>
      compareSessionsForSort(a.session, b.session, mode, direction)
    ),
  }))
}
