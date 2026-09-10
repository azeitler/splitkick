import { describe, expect, it } from 'vitest'
import type { Session } from '@/types/chat'
import type { Worktree } from '@/types/projects'
import {
  LAST_ACTIVE_LABEL_MIN_AGE_MS,
  STALE_ACTIVITY_MS,
  compareSessionsForSort,
  compareWorktreesForCanvasSort,
  defaultSessionSortDirection,
  getSessionActivityTimestamp,
  getWorktreeLastActivity,
  isStaleActivity,
  shouldFadeRow,
  shouldShowLastActive,
  sortSessionGroups,
} from './worktree-sort-utils'

function worktree(overrides: Partial<Worktree> & { id: string }): Worktree {
  const { id, ...rest } = overrides
  return {
    id,
    project_id: 'project-1',
    name: rest.name ?? id,
    path: `/tmp/${id}`,
    branch: rest.branch ?? rest.name ?? id,
    created_at: overrides.created_at ?? 1,
    order: overrides.order ?? 0,
    ...rest,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'session-1',
    name: overrides.name ?? 'Session 1',
    order: overrides.order ?? 0,
    created_at: overrides.created_at ?? 1,
    updated_at: overrides.updated_at ?? overrides.created_at ?? 1,
    messages: overrides.messages ?? [],
    ...overrides,
  } as Session
}

describe('worktree-sort-utils', () => {
  it('prefers last_message_at over updated_at and created_at', () => {
    expect(
      getSessionActivityTimestamp(
        session({ created_at: 10, updated_at: 20, last_message_at: 30 })
      )
    ).toBe(30)
    expect(getSessionActivityTimestamp(session({ created_at: 10 }))).toBe(10)
  })

  it('finds latest activity across sessions with worktree fallback', () => {
    expect(
      getWorktreeLastActivity(
        [
          session({ id: 'old', created_at: 10, updated_at: 20 }),
          session({ id: 'new', created_at: 30, last_message_at: 40 }),
        ],
        5
      )
    ).toBe(40)

    expect(getWorktreeLastActivity([], 50)).toBe(50)
  })

  it('sorts base sessions first, then by last activity desc', () => {
    const base = worktree({
      id: 'base',
      name: 'main',
      branch: 'main',
      session_type: 'base',
      created_at: 1,
    })
    const recent = worktree({ id: 'recent', created_at: 10 })
    const old = worktree({ id: 'old', created_at: 20 })
    const latestById = new Map([
      ['base', 1],
      ['recent', 100],
      ['old', 50],
    ])

    const sorted = [old, recent, base].sort((a, b) =>
      compareWorktreesForCanvasSort(a, b, latestById, 'last_activity')
    )

    expect(sorted.map(w => w.id)).toEqual(['base', 'recent', 'old'])
  })

  it('sorts created mode by created_at desc after base sessions', () => {
    const newest = worktree({ id: 'newest', created_at: 30, order: 100 })
    const oldest = worktree({ id: 'oldest', created_at: 10, order: 0 })
    const middle = worktree({ id: 'middle', created_at: 20, order: 50 })

    const sorted = [oldest, newest, middle].sort((a, b) =>
      compareWorktreesForCanvasSort(a, b, new Map(), 'created')
    )

    expect(sorted.map(w => w.id)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('sorts manual mode by persisted order after base sessions', () => {
    const base = worktree({
      id: 'base',
      session_type: 'base',
      created_at: 1,
      order: 0,
    })
    const first = worktree({ id: 'first', created_at: 10, order: 1 })
    const second = worktree({ id: 'second', created_at: 30, order: 2 })
    const third = worktree({ id: 'third', created_at: 20, order: 3 })

    const sorted = [third, second, base, first].sort((a, b) =>
      compareWorktreesForCanvasSort(a, b, new Map(), 'manual')
    )

    expect(sorted.map(w => w.id)).toEqual(['base', 'first', 'second', 'third'])
  })

  it('uses created_at as manual mode tie-breaker', () => {
    const older = worktree({ id: 'older', created_at: 10, order: 1 })
    const newer = worktree({ id: 'newer', created_at: 20, order: 1 })

    const sorted = [older, newer].sort((a, b) =>
      compareWorktreesForCanvasSort(a, b, new Map(), 'manual')
    )

    expect(sorted.map(w => w.id)).toEqual(['newer', 'older'])
  })

  it('uses created_at as tie-breaker', () => {
    const older = worktree({ id: 'older', created_at: 10 })
    const newer = worktree({ id: 'newer', created_at: 20 })
    const latestById = new Map([
      ['older', 100],
      ['newer', 100],
    ])

    const sorted = [older, newer].sort((a, b) =>
      compareWorktreesForCanvasSort(a, b, latestById, 'last_activity')
    )

    expect(sorted.map(w => w.id)).toEqual(['newer', 'older'])
  })
})

describe('isStaleActivity', () => {
  const now = Date.UTC(2026, 8, 1) // fixed clock so the tests never drift
  const hour = 60 * 60 * 1000
  const day = 24 * hour

  it('flags a millisecond timestamp older than two days', () => {
    expect(isStaleActivity(now - 3 * day, now)).toBe(true)
  })

  it('does not flag a millisecond timestamp inside the two days', () => {
    expect(isStaleActivity(now - hour, now)).toBe(false)
    expect(isStaleActivity(now - 47 * hour, now)).toBe(false)
  })

  it('normalizes second-precision timestamps before comparing', () => {
    const threeDaysAgoInSeconds = Math.floor((now - 3 * day) / 1000)
    expect(isStaleActivity(threeDaysAgoInSeconds, now)).toBe(true)

    const oneDayAgoInSeconds = Math.floor((now - day) / 1000)
    expect(isStaleActivity(oneDayAgoInSeconds, now)).toBe(false)
  })

  it('treats exactly 48 hours as not stale', () => {
    expect(isStaleActivity(now - STALE_ACTIVITY_MS, now)).toBe(false)
    expect(isStaleActivity(now - STALE_ACTIVITY_MS - 1, now)).toBe(true)
  })

  // The fade and the age label must agree: formatRelativeTime floors to whole
  // days, so a row can never read "1d ago" while faded, nor "2d ago" while not.
  it('turns over where the day label does', () => {
    expect(isStaleActivity(now - (2 * day - 1), now)).toBe(false)
    expect(isStaleActivity(now - (2 * day + 1), now)).toBe(true)
  })

  it('does not flag timestamps in the future', () => {
    expect(isStaleActivity(now + day, now)).toBe(false)
  })
})

describe('shouldShowLastActive', () => {
  const now = Date.UTC(2026, 8, 1)
  const minute = 60 * 1000

  it('hides the age for anything touched in the last hour', () => {
    expect(shouldShowLastActive(now, now)).toBe(false)
    expect(shouldShowLastActive(now - 59 * minute, now)).toBe(false)
  })

  it('shows the age from one hour onwards', () => {
    expect(shouldShowLastActive(now - LAST_ACTIVE_LABEL_MIN_AGE_MS, now)).toBe(
      true
    )
    expect(shouldShowLastActive(now - 3 * 60 * minute, now)).toBe(true)
  })

  it('normalizes second-precision timestamps before comparing', () => {
    const threeHoursAgoInSeconds = Math.floor((now - 180 * minute) / 1000)
    expect(shouldShowLastActive(threeHoursAgoInSeconds, now)).toBe(true)

    const tenMinutesAgoInSeconds = Math.floor((now - 10 * minute) / 1000)
    expect(shouldShowLastActive(tenMinutesAgoInSeconds, now)).toBe(false)
  })

  it('hides the age for timestamps in the future', () => {
    expect(shouldShowLastActive(now + 60 * minute, now)).toBe(false)
  })
})

describe('shouldFadeRow', () => {
  const now = Date.UTC(2026, 8, 1)
  const day = 24 * 60 * 60 * 1000

  it('fades a row idle for longer than two days', () => {
    expect(shouldFadeRow(now - 3 * day, false, now)).toBe(true)
  })

  it('leaves a recently used row alone', () => {
    expect(shouldFadeRow(now - day, false, now)).toBe(false)
  })

  it('never fades the row you are on, however old', () => {
    expect(shouldFadeRow(now - 400 * day, true, now)).toBe(false)
  })

  // Regression: the fade used to be gated on session status too. Status is
  // derived from persisted state, so a session abandoned mid-question reports
  // `waiting` forever and stayed bright next to equally dead idle rows. Age is
  // now the only input, so every row of the same age fades alike.
  it('depends on age alone, so equally old rows agree', () => {
    const threeDaysAgo = now - 3 * day
    expect(shouldFadeRow(threeDaysAgo, false, now)).toBe(true)
    expect(shouldFadeRow(threeDaysAgo - day, false, now)).toBe(true)
  })

  it('cannot fade live work, whose activity timestamp is the running turn', () => {
    expect(shouldFadeRow(now, false, now)).toBe(false)
  })
})

describe('session sort', () => {
  function named(id: string, name: string, lastMessageAt = 0): Session {
    return session({ id, name, last_message_at: lastMessageAt })
  }

  function order(
    sessions: Session[],
    mode: 'title' | 'last_activity',
    direction: 'asc' | 'desc'
  ): string[] {
    return [...sessions]
      .sort((a, b) => compareSessionsForSort(a, b, mode, direction))
      .map(s => s.name)
  }

  it('starts activity at newest first and titles at A to Z', () => {
    expect(defaultSessionSortDirection('last_activity')).toBe('desc')
    expect(defaultSessionSortDirection('title')).toBe('asc')
  })

  it('sorts titles case-insensitively', () => {
    const sessions = [
      named('a', 'beta'),
      named('b', 'Alpha'),
      named('c', 'gamma'),
    ]
    expect(order(sessions, 'title', 'asc')).toEqual(['Alpha', 'beta', 'gamma'])
    expect(order(sessions, 'title', 'desc')).toEqual(['gamma', 'beta', 'Alpha'])
  })

  // The reason for numeric collation: a plain string compare puts "10" first.
  it('puts session 2 before session 10', () => {
    const sessions = [named('a', 'session 10'), named('b', 'session 2')]
    expect(order(sessions, 'title', 'asc')).toEqual(['session 2', 'session 10'])
  })

  it('sorts by last activity in both directions', () => {
    const sessions = [
      named('a', 'old', 1_000),
      named('b', 'new', 3_000),
      named('c', 'mid', 2_000),
    ]
    expect(order(sessions, 'last_activity', 'desc')).toEqual([
      'new',
      'mid',
      'old',
    ])
    expect(order(sessions, 'last_activity', 'asc')).toEqual([
      'old',
      'mid',
      'new',
    ])
  })

  // Older records store seconds, newer ones milliseconds. Unnormalised, a
  // seconds value would always read as the oldest.
  it('compares second and millisecond timestamps on one scale', () => {
    const sessions = [
      named('a', 'seconds, newer', 2_000_000_000),
      named('b', 'millis, older', 1_900_000_000_000),
    ]
    expect(order(sessions, 'last_activity', 'desc')).toEqual([
      'seconds, newer',
      'millis, older',
    ])
  })

  it('breaks ties by the other key, then by id, so the order is stable', () => {
    const sessions = [
      named('b', 'Same', 5),
      named('a', 'Same', 5),
      named('c', 'Same', 9),
    ]
    expect(
      [...sessions]
        .sort((x, y) => compareSessionsForSort(x, y, 'title', 'asc'))
        .map(s => s.id)
    ).toEqual(['c', 'a', 'b'])
  })

  describe('sortSessionGroups', () => {
    const groups = [
      {
        key: 'inProgress',
        cards: [
          { session: named('a', 'zeta', 1) },
          { session: named('b', 'alpha', 2) },
        ],
      },
      {
        key: 'idle',
        cards: [
          { session: named('c', 'mu', 3) },
          { session: named('d', 'beta', 4) },
        ],
      },
    ]

    it('leaves the default order exactly as the groups produced it', () => {
      expect(sortSessionGroups(groups, 'default', 'asc')).toBe(groups)
    })

    it('sorts inside each group and keeps the groups in place', () => {
      const sorted = sortSessionGroups(groups, 'title', 'asc')

      expect(sorted.map(group => group.key)).toEqual(['inProgress', 'idle'])
      expect(sorted[0]?.cards.map(card => card.session.name)).toEqual([
        'alpha',
        'zeta',
      ])
      expect(sorted[1]?.cards.map(card => card.session.name)).toEqual([
        'beta',
        'mu',
      ])
    })

    it('does not mutate the groups it was given', () => {
      sortSessionGroups(groups, 'title', 'asc')
      expect(groups[0]?.cards.map(card => card.session.name)).toEqual([
        'zeta',
        'alpha',
      ])
    })
  })
})
