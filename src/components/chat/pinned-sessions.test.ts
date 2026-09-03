import { describe, expect, it } from 'vitest'
import type { Session } from '@/types/chat'
import type { Worktree } from '@/types/projects'
import { resolvePinnedSessionRows } from './pinned-sessions'

function worktree(overrides: Partial<Worktree>): Worktree {
  return {
    id: overrides.id ?? 'wt-1',
    project_id: 'project-1',
    name: overrides.name ?? 'worktree',
    path: `/tmp/${overrides.name ?? 'worktree'}`,
    branch: 'branch',
    created_at: 1,
    session_type: 'worktree',
    order: 0,
    ...overrides,
  }
}

function session(id: string, name = id): Session {
  return {
    id,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
  } as Session
}

const worktrees = [
  worktree({ id: 'wt-1', name: 'feature-a' }),
  worktree({ id: 'wt-2', name: 'feature-b' }),
  worktree({ id: 'wt-base', name: 'main', session_type: 'base' }),
]

const sessionsByWorktree: Record<string, Session[]> = {
  'wt-1': [session('s-1', 'Investigation'), session('s-2')],
  'wt-2': [session('s-3', 'Review')],
  'wt-base': [session('s-base')],
}

const getSessions = (worktreeId: string) => sessionsByWorktree[worktreeId]

describe('resolvePinnedSessionRows', () => {
  it('returns an empty list when nothing is pinned', () => {
    expect(resolvePinnedSessionRows([], getSessions, worktrees)).toEqual([])
    expect(resolvePinnedSessionRows(undefined, getSessions, worktrees)).toEqual(
      []
    )
  })

  it('resolves pins in pin order with the owning worktree name and path', () => {
    const rows = resolvePinnedSessionRows(
      [
        { sessionId: 's-3', worktreeId: 'wt-2' },
        { sessionId: 's-1', worktreeId: 'wt-1' },
      ],
      getSessions,
      worktrees
    )

    expect(rows.map(row => row.sessionId)).toEqual(['s-3', 's-1'])
    expect(rows[0]).toMatchObject({
      worktreeId: 'wt-2',
      worktreeName: 'feature-b',
      worktreePath: '/tmp/feature-b',
    })
    expect(rows[0]?.session.name).toBe('Review')
    expect(rows[1]?.worktreeName).toBe('feature-a')
  })

  it('names the base worktree "Base Session"', () => {
    const rows = resolvePinnedSessionRows(
      [{ sessionId: 's-base', worktreeId: 'wt-base' }],
      getSessions,
      worktrees
    )

    expect(rows[0]?.worktreeName).toBe('Base Session')
  })

  it('drops a pin whose session is gone (archived or deleted)', () => {
    const rows = resolvePinnedSessionRows(
      [
        { sessionId: 's-archived', worktreeId: 'wt-1' },
        { sessionId: 's-1', worktreeId: 'wt-1' },
      ],
      getSessions,
      worktrees
    )

    expect(rows.map(row => row.sessionId)).toEqual(['s-1'])
  })

  it('drops a pin whose worktree was removed', () => {
    const rows = resolvePinnedSessionRows(
      [{ sessionId: 's-1', worktreeId: 'wt-deleted' }],
      getSessions,
      worktrees
    )

    expect(rows).toEqual([])
  })

  it('drops every pin while the worktree sessions have not loaded yet', () => {
    const rows = resolvePinnedSessionRows(
      [{ sessionId: 's-1', worktreeId: 'wt-1' }],
      () => undefined,
      worktrees
    )

    expect(rows).toEqual([])
  })

  it('does not match a session id that belongs to another worktree', () => {
    const rows = resolvePinnedSessionRows(
      [{ sessionId: 's-1', worktreeId: 'wt-2' }],
      getSessions,
      worktrees
    )

    expect(rows).toEqual([])
  })
})
