import { describe, expect, it } from 'vitest'
import { buildSessionCommands } from './session-commands'
import type { AllSessionsEntry, Session } from '@/types/chat'

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    name: overrides.id,
    order: 0,
    created_at: 0,
    updated_at: 0,
    messages: [],
    ...overrides,
  } as Session
}

function entry(overrides: Partial<AllSessionsEntry> = {}): AllSessionsEntry {
  return {
    project_id: 'project-1',
    project_name: 'Jean',
    worktree_id: 'worktree-1',
    worktree_name: 'main',
    worktree_path: '/projects/jean',
    sessions: [],
    ...overrides,
  }
}

const entries: AllSessionsEntry[] = [
  entry({
    sessions: [
      session({ id: 'a', name: 'Fix the parser', updated_at: 300 }),
      session({ id: 'b', name: 'Refactor toolbar', updated_at: 200 }),
      session({
        id: 'c',
        name: 'Archived work',
        updated_at: 999,
        archived_at: 5,
      }),
    ],
  }),
  entry({
    project_id: 'project-2',
    project_name: 'Coolify',
    worktree_id: 'worktree-2',
    worktree_name: 'feat/deploy',
    worktree_path: '/projects/coolify',
    sessions: [
      session({ id: 'd', name: 'Deploy pipeline', updated_at: 100 }),
      session({ id: 'e', name: 'Parser rewrite', updated_at: 50 }),
    ],
  }),
]

describe('buildSessionCommands', () => {
  it('lists the most recent sessions when there is no query', () => {
    const result = buildSessionCommands({ entries, query: '', recentLimit: 3 })

    expect(result.map(c => c.session.id)).toEqual(['a', 'b', 'd'])
  })

  it('excludes archived sessions', () => {
    const result = buildSessionCommands({ entries, query: '' })

    expect(result.map(c => c.session.id)).not.toContain('c')
  })

  it('excludes the session that is already open', () => {
    const result = buildSessionCommands({
      entries,
      query: '',
      excludeSessionId: 'a',
    })

    expect(result.map(c => c.session.id)).not.toContain('a')
    expect(result[0]?.session.id).toBe('b')
  })

  it('normalizes second and millisecond timestamps before sorting', () => {
    const mixed = [
      entry({
        sessions: [
          // 2 000 000 000 s is far newer than 1 700 000 000 000 ms
          session({ id: 'seconds', updated_at: 2_000_000_000 }),
          session({ id: 'millis', updated_at: 1_700_000_000_000 }),
        ],
      }),
    ]

    const result = buildSessionCommands({ entries: mixed, query: '' })

    expect(result.map(c => c.session.id)).toEqual(['seconds', 'millis'])
  })

  it('matches on session name, project, worktree and label', () => {
    const byName = buildSessionCommands({ entries, query: 'toolbar' })
    expect(byName.map(c => c.session.id)).toEqual(['b'])

    const byProject = buildSessionCommands({ entries, query: 'coolify' })
    expect(byProject.map(c => c.session.id)).toEqual(['d', 'e'])

    const byWorktree = buildSessionCommands({ entries, query: 'feat/deploy' })
    expect(byWorktree.map(c => c.session.id)).toEqual(['d', 'e'])

    const byLabel = buildSessionCommands({
      entries,
      query: 'needs testing',
      sessionLabels: { b: { name: 'Needs testing', color: '#eab308' } },
    })
    expect(byLabel.map(c => c.session.id)).toEqual(['b'])
  })

  it('prefers the live store label over the persisted one', () => {
    const withLabel = [
      entry({
        sessions: [
          session({
            id: 'a',
            label: { name: 'Stale label', color: '#000000' },
          }),
        ],
      }),
    ]

    const stale = buildSessionCommands({
      entries: withLabel,
      query: 'stale',
      sessionLabels: { a: { name: 'Fresh label', color: '#ffffff' } },
    })
    expect(stale).toHaveLength(0)

    const fresh = buildSessionCommands({
      entries: withLabel,
      query: 'fresh',
      sessionLabels: { a: { name: 'Fresh label', color: '#ffffff' } },
    })
    expect(fresh).toHaveLength(1)
  })

  it('ranks name matches above project or worktree matches', () => {
    // "Parser rewrite" (name prefix) beats "Fix the parser" (name substring),
    // and both beat a session that only matched via its worktree name.
    const parserEntries = [
      entry({
        worktree_name: 'parser-work',
        sessions: [
          session({ id: 'worktree-only', name: 'Unrelated', updated_at: 900 }),
        ],
      }),
      entry({
        sessions: [
          session({ id: 'substring', name: 'Fix the parser', updated_at: 800 }),
          session({ id: 'prefix', name: 'Parser rewrite', updated_at: 1 }),
        ],
      }),
    ]

    const result = buildSessionCommands({
      entries: parserEntries,
      query: 'parser',
    })

    expect(result.map(c => c.session.id)).toEqual([
      'prefix',
      'substring',
      'worktree-only',
    ])
  })

  it('respects the search limit', () => {
    const result = buildSessionCommands({ entries, query: 'e', searchLimit: 2 })

    expect(result).toHaveLength(2)
  })

  it('keeps the session id out of the match text but inside the cmdk value', () => {
    const uuid = 'f857c4c5-dead-beef-0000-000000000001'
    const withUuid = [
      entry({ sessions: [session({ id: uuid, name: 'Refactor toolbar' })] }),
    ]

    const first = buildSessionCommands({
      entries: withUuid,
      query: 'toolbar',
    })[0]

    expect(first?.matchText).toBe('refactor toolbar jean main ')
    expect(first?.searchValue).toContain(uuid)
    expect(first?.description).toBe('Jean · main')

    // A query that only appears in the uuid must not surface the session.
    expect(
      buildSessionCommands({ entries: withUuid, query: 'beef' })
    ).toHaveLength(0)
  })
})
