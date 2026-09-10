import { describe, it, expect } from 'vitest'
import {
  flattenAllSessions,
  matchesSessionQuery,
  resolveSessionLabel,
  resolveStarredSessions,
} from './home-utils'
import type { AllSessionsEntry, LabelData, Session } from '@/types/chat'

function session(overrides: Partial<Session>): Session {
  return {
    id: 'session',
    name: 'Session',
    created_at: 1,
    updated_at: 1,
    messages: [],
    order: 0,
    ...overrides,
  } as unknown as Session
}

function entry(sessions: Session[], suffix = 'a'): AllSessionsEntry {
  return {
    project_id: `project-${suffix}`,
    project_name: `Project ${suffix}`,
    worktree_id: `worktree-${suffix}`,
    worktree_name: `Worktree ${suffix}`,
    worktree_path: `/tmp/${suffix}`,
    sessions,
  }
}

describe('flattenAllSessions', () => {
  it('sorts every project together, newest activity first', () => {
    const rows = flattenAllSessions([
      entry([session({ id: 'old', updated_at: 10 })], 'a'),
      entry([session({ id: 'new', updated_at: 30 })], 'b'),
      entry([session({ id: 'mid', updated_at: 20 })], 'c'),
    ])

    expect(rows.map(row => row.session.id)).toEqual(['new', 'mid', 'old'])
  })

  it('carries the project and worktree of each session', () => {
    const rows = flattenAllSessions([entry([session({ id: 's' })], 'a')])
    const [row] = rows
    if (!row) throw new Error('expected one row')

    expect(row.projectId).toBe('project-a')
    expect(row.projectName).toBe('Project a')
    expect(row.worktreeId).toBe('worktree-a')
    expect(row.worktreeName).toBe('Worktree a')
    expect(row.worktreePath).toBe('/tmp/a')
  })

  it('leaves archived sessions out', () => {
    const rows = flattenAllSessions([
      entry([
        session({ id: 'live' }),
        session({ id: 'archived', archived_at: 5 }),
      ]),
    ])

    expect(rows.map(row => row.session.id)).toEqual(['live'])
  })

  it('prefers the last message over the update time', () => {
    const rows = flattenAllSessions([
      entry([session({ id: 'a', updated_at: 5, last_message_at: 50 })], 'a'),
      entry([session({ id: 'b', updated_at: 40 })], 'b'),
    ])

    expect(rows.map(row => row.session.id)).toEqual(['a', 'b'])
  })

  it('returns nothing for an empty response', () => {
    expect(flattenAllSessions([])).toEqual([])
  })
})

describe('resolveSessionLabel', () => {
  const stored: LabelData = { name: 'Stored', color: '#111111' }
  const unsaved: LabelData = { name: 'Unsaved', color: '#222222' }

  it('uses the unsaved store label first', () => {
    const target = session({ id: 's', label: stored })
    expect(resolveSessionLabel(target, { s: unsaved })).toBe(unsaved)
  })

  it('falls back to the persisted label', () => {
    const target = session({ id: 's', label: stored })
    expect(resolveSessionLabel(target, {})).toBe(stored)
  })

  it('returns nothing when the session has no label', () => {
    expect(resolveSessionLabel(session({ id: 's' }), {})).toBeUndefined()
  })
})

describe('resolveStarredSessions', () => {
  const star = (sessionId: string, worktree = 'worktree-a') => ({
    projectId: 'project-a',
    worktreeId: worktree,
    sessionId,
  })

  it('keeps star order, not activity order', () => {
    const rows = resolveStarredSessions(
      [star('old'), star('new')],
      [
        entry([
          session({ id: 'new', last_message_at: 9_000 }),
          session({ id: 'old', last_message_at: 1_000 }),
        ]),
      ]
    )

    expect(rows.map(row => row.session.id)).toEqual(['old', 'new'])
  })

  it('resolves across projects and carries the owning project', () => {
    const rows = resolveStarredSessions(
      [star('in-b')],
      [
        entry([session({ id: 'in-a' })], 'a'),
        entry([session({ id: 'in-b' })], 'b'),
      ]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      projectId: 'project-b',
      projectName: 'Project b',
      worktreeName: 'Worktree b',
    })
  })

  // A star names a worktree, but a session can be moved to another one. The
  // star must follow the session instead of vanishing.
  it('follows a session that moved to another workspace', () => {
    const rows = resolveStarredSessions(
      [star('moved', 'worktree-a')],
      [entry([session({ id: 'moved' })], 'b')]
    )

    expect(rows[0]?.worktreeId).toBe('worktree-b')
  })

  it('leaves out archived and missing sessions', () => {
    const rows = resolveStarredSessions(
      [star('archived'), star('gone'), star('live')],
      [
        entry([
          session({ id: 'archived', archived_at: 5 } as Partial<Session>),
          session({ id: 'live' }),
        ]),
      ]
    )

    expect(rows.map(row => row.session.id)).toEqual(['live'])
  })

  it('returns nothing before the sessions have loaded', () => {
    expect(resolveStarredSessions([star('a')], [])).toEqual([])
  })
})

describe('matchesSessionQuery', () => {
  const [row] = flattenAllSessions([
    entry([session({ id: 's', name: 'Fix sidebar naming' })], 'a'),
  ])
  if (!row) throw new Error('expected one row')

  it('matches everything while the query is blank', () => {
    expect(matchesSessionQuery(row, '')).toBe(true)
    expect(matchesSessionQuery(row, '   ')).toBe(true)
  })

  it('matches the session name, ignoring case and outer spaces', () => {
    expect(matchesSessionQuery(row, 'SIDEBAR')).toBe(true)
    expect(matchesSessionQuery(row, '  naming ')).toBe(true)
  })

  it('matches the project and the worktree, so a project name narrows the list', () => {
    expect(matchesSessionQuery(row, 'project a')).toBe(true)
    expect(matchesSessionQuery(row, 'worktree a')).toBe(true)
  })

  it('matches the label the row shows', () => {
    const bug: LabelData = { name: 'Bug', color: '#ef4444' }
    expect(matchesSessionQuery(row, 'bug', bug)).toBe(true)
    expect(matchesSessionQuery(row, 'bug')).toBe(false)
  })

  it('matches a blank name under the word the row shows', () => {
    const [untitled] = flattenAllSessions([
      entry([session({ id: 'u', name: '' })]),
    ])
    if (!untitled) throw new Error('expected one row')
    expect(matchesSessionQuery(untitled, 'untitled')).toBe(true)
  })

  it('rejects a row where nothing matches', () => {
    expect(matchesSessionQuery(row, 'release')).toBe(false)
  })
})
