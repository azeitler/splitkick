import { describe, it, expect } from 'vitest'
import type { Session, WorktreeSessions } from '@/types/chat'
import {
  filterSessionsByQuery,
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
