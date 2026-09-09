import { describe, it, expect } from 'vitest'
import type { LabelData, Session, WorktreeSessions } from '@/types/chat'
import { createLabelFilter } from '@/lib/label-filter'
import {
  collectSessionLabelSources,
  filterSessions,
  filterSessionsByQuery,
  selectWorktreesMatchingFilters,
  selectWorktreesMatchingQuery,
} from './session-filter-utils'

function session(id: string, name: string): Session {
  return {
    id,
    name,
    order: 0,
    created_at: 0,
    updated_at: 0,
    messages: [],
  } as Session
}

function worktreeSessions(
  worktreeId: string,
  sessions: Session[]
): WorktreeSessions {
  return {
    worktree_id: worktreeId,
    sessions,
    active_session_id: null,
    version: 2,
  } as WorktreeSessions
}

describe('filterSessionsByQuery', () => {
  it('returns every session for a blank query, past the fuzzy search limit', () => {
    // fuzzySearchItems defaults to limit 15 — the helper must override it.
    const sessions = Array.from({ length: 20 }, (_, index) =>
      session(`s${index}`, `Session ${index}`)
    )

    expect(filterSessionsByQuery(sessions, '')).toHaveLength(20)
    expect(filterSessionsByQuery(sessions, '   ')).toHaveLength(20)
  })

  it('matches loosely and ignores case', () => {
    const sessions = [
      session('a', 'Auth Refactor'),
      session('b', 'Billing dashboard'),
    ]

    const result = filterSessionsByQuery(sessions, 'auth')
    expect(result.map(s => s.id)).toEqual(['a'])
  })

  it('returns nothing when no name matches', () => {
    const sessions = [session('a', 'Auth Refactor')]
    expect(filterSessionsByQuery(sessions, 'zzzzzzzz')).toEqual([])
  })

  it('keeps the input order rather than relevance order', () => {
    const sessions = [
      session('a', 'Login retry logic'),
      session('b', 'Login'),
      session('c', 'Login form styles'),
    ]

    const result = filterSessionsByQuery(sessions, 'login')
    expect(result.map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('matches a blank name under "untitled"', () => {
    const sessions = [session('a', ''), session('b', 'Auth Refactor')]
    expect(filterSessionsByQuery(sessions, 'untitled').map(s => s.id)).toEqual([
      'a',
    ])
  })

  it('leaves an empty list alone', () => {
    expect(filterSessionsByQuery([], 'auth')).toEqual([])
  })
})

describe('selectWorktreesMatchingQuery', () => {
  const worktrees = [{ id: 'w1' }, { id: 'w2' }, { id: 'pending' }]
  const sessionsByWorktreeId = new Map([
    ['w1', worktreeSessions('w1', [session('a', 'Auth Refactor')])],
    ['w2', worktreeSessions('w2', [session('b', 'Billing dashboard')])],
  ])

  it('returns every worktree for a blank query', () => {
    expect(
      selectWorktreesMatchingQuery(worktrees, sessionsByWorktreeId, '  ')
    ).toBe(worktrees)
  })

  it('drops worktrees with no matching session', () => {
    const result = selectWorktreesMatchingQuery(
      worktrees,
      sessionsByWorktreeId,
      'auth'
    )
    expect(result.map(w => w.id)).toEqual(['w1'])
  })

  it('drops worktrees that have no session data yet', () => {
    const result = selectWorktreesMatchingQuery(
      worktrees,
      sessionsByWorktreeId,
      'a'
    )
    expect(result.map(w => w.id)).not.toContain('pending')
  })
})

describe('filterSessions', () => {
  const bug: LabelData = { name: 'Bug', color: '#ef4444' }
  const testing: LabelData = { name: 'Needs testing', color: '#eab308' }

  const labelled = (id: string, name: string, label?: LabelData) =>
    ({ id, name, label }) as unknown as Session

  const sessions = [
    labelled('a', 'auth flow', bug),
    labelled('b', 'billing', testing),
    labelled('c', 'cache', undefined),
  ]

  const criteria = (
    query: string,
    labels: string[],
    sessionLabels: Record<string, LabelData> = {}
  ) => ({
    query,
    labelFilter: createLabelFilter(labels),
    sessionLabels,
  })

  it('returns the input when nothing narrows the list', () => {
    expect(filterSessions(sessions, criteria('', []))).toBe(sessions)
  })

  it('narrows by label alone', () => {
    const result = filterSessions(sessions, criteria('', ['bug']))
    expect(result.map(s => s.id)).toEqual(['a'])
  })

  it('applies the query and the label together', () => {
    expect(filterSessions(sessions, criteria('auth', ['bug'])).map(s => s.id)).toEqual(
      ['a']
    )
    expect(filterSessions(sessions, criteria('billing', ['bug']))).toEqual([])
  })

  it('uses the unsaved store label', () => {
    const result = filterSessions(
      sessions,
      criteria('', ['bug'], { c: bug })
    )
    expect(result.map(s => s.id)).toEqual(['a', 'c'])
  })
})

describe('selectWorktreesMatchingFilters', () => {
  const bug: LabelData = { name: 'Bug', color: '#ef4444' }
  const worktrees = [{ id: 'w1' }, { id: 'w2' }]
  const byId = new Map<string, WorktreeSessions>([
    [
      'w1',
      {
        worktree_id: 'w1',
        sessions: [{ id: 's1', name: 'one', label: bug } as unknown as Session],
      } as WorktreeSessions,
    ],
    [
      'w2',
      {
        worktree_id: 'w2',
        sessions: [{ id: 's2', name: 'two' } as unknown as Session],
      } as WorktreeSessions,
    ],
  ])

  it('keeps only worktrees holding a matching session', () => {
    const result = selectWorktreesMatchingFilters(worktrees, byId, {
      query: '',
      labelFilter: createLabelFilter(['bug']),
      sessionLabels: {},
    })
    expect(result.map(w => w.id)).toEqual(['w1'])
  })

  it('returns the input when the filter is empty', () => {
    const result = selectWorktreesMatchingFilters(worktrees, byId, {
      query: '  ',
      labelFilter: createLabelFilter([]),
      sessionLabels: {},
    })
    expect(result).toBe(worktrees)
  })
})

describe('collectSessionLabelSources', () => {
  it('lists one entry per labelled session, store labels first', () => {
    const bug: LabelData = { name: 'Bug', color: '#ef4444' }
    const stored: LabelData = { name: 'Stored', color: '#111111' }
    const byId = new Map<string, WorktreeSessions>([
      [
        'w1',
        {
          worktree_id: 'w1',
          sessions: [
            { id: 's1', name: 'one', label: stored } as unknown as Session,
            { id: 's2', name: 'two' } as unknown as Session,
          ],
        } as WorktreeSessions,
      ],
    ])

    expect(collectSessionLabelSources(byId, { s1: bug })).toEqual([[bug]])
  })
})
