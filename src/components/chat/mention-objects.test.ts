import { describe, expect, it } from 'vitest'
import type { Agent } from '@/types/agents'
import type { AllSessionsEntry, Session } from '@/types/chat'
import type { Project } from '@/types/projects'
import {
  buildMentionObjects,
  looksLikePath,
  mentionMarkdown,
  orderMentionGroups,
  searchMentionGroup,
  type MentionObject,
} from './mention-objects'

function session(id: string, name: string, updatedAt: number, extra = {}) {
  return {
    id,
    name,
    updated_at: updatedAt,
    created_at: 0,
    ...extra,
  } as unknown as Session
}

function entry(
  projectId: string,
  worktreeId: string,
  sessions: Session[]
): AllSessionsEntry {
  return {
    project_id: projectId,
    project_name: projectId === 'p1' ? 'Acme' : 'Other',
    worktree_id: worktreeId,
    worktree_name: `wt-${worktreeId}`,
    worktree_path: `/Users/me/work/${worktreeId}`,
    sessions,
  }
}

function project(id: string, name: string, extra = {}): Project {
  return {
    id,
    name,
    path: `/Users/me/${name}`,
    default_branch: 'main',
    added_at: 0,
    order: 0,
    ...extra,
  } as Project
}

function agent(id: string, name: string, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    name,
    scope: 'project',
    projectId: 'p1',
    projectName: 'Acme',
    roleId: null,
    worktreeId: 'w1',
    worktreePath: null,
    sessionId: 's1',
    sessionName: 'Agent session',
    pastSessionIds: [],
    createdAt: 0,
    ...extra,
  }
}

const sources = {
  entries: [
    entry('p1', 'w1', [
      session('s1', 'Fix login', 100),
      session('s-current', 'This chat', 999),
      session('s-arch', 'Old work', 50, { archived_at: 60 }),
    ]),
    entry('p2', 'w2', [session('s2', 'Release notes', 500)]),
  ],
  projects: [
    project('p1', 'Acme'),
    project('p2', 'Other'),
    project('hidden', 'Home of agents', { hidden: true }),
    project('folder', 'A folder', { is_folder: true }),
  ],
  agents: [
    agent('a1', 'Release manager'),
    agent('a2', 'Ops', { scope: 'global', projectId: 'hidden' }),
    agent('a3', 'Elsewhere', { projectId: 'p2', projectName: 'Other' }),
  ],
  connections: [
    { id: 'c1', name: 'Mac 2', url: 'https://box.tail1234.ts.net:3456' },
  ],
  currentProjectId: 'p1',
  currentSessionId: 's-current',
}

describe('buildMentionObjects', () => {
  const groups = buildMentionObjects(sources)

  it('skips the current session and archived sessions', () => {
    expect(groups.session.map(s => s.id)).toEqual(['s1', 's2'])
    expect(groups.session[0]).toMatchObject({
      detail: 'Acme › wt-w1',
      likely: true,
    })
  })

  it('lists worktrees with their path and visible, non-folder projects', () => {
    expect(groups.worktree.map(w => w.detail)).toEqual([
      '/Users/me/work/w1',
      '/Users/me/work/w2',
    ])
    expect(groups.project.map(p => p.id)).toEqual(['p1', 'p2'])
  })

  it('shows the scope of an agent and the host of a connection', () => {
    expect(groups.agent.map(a => a.detail)).toEqual([
      'Project agent · Acme',
      'Global agent',
      'Project agent · Other',
    ])
    expect(groups.connection[0]?.detail).toBe('box.tail1234.ts.net:3456')
  })
})

describe('searchMentionGroup', () => {
  const groups = buildMentionObjects(sources)

  it('puts the current project first while browsing, then the most recent', () => {
    // s2 is newer, but s1 is in the current project.
    expect(searchMentionGroup(groups.session, '').map(r => r.item.id)).toEqual([
      's1',
      's2',
    ])
    expect(searchMentionGroup(groups.agent, '').map(r => r.item.id)).toEqual([
      'a1',
      'a2',
      'a3',
    ])
  })

  it('finds by name and by detail', () => {
    expect(
      searchMentionGroup(groups.session, 'release').map(r => r.item.id)
    ).toEqual(['s2'])
    expect(
      searchMentionGroup(groups.session, 'acme').map(r => r.item.id)
    ).toEqual(['s1'])
  })

  it('prefers a likely target over an equal match elsewhere', () => {
    const items: MentionObject[] = [
      {
        kind: 'session',
        id: 'far',
        name: 'Deploy',
        detail: '',
        likely: false,
        recency: 9,
      },
      {
        kind: 'session',
        id: 'near',
        name: 'Deploy',
        detail: '',
        likely: true,
        recency: 1,
      },
    ]
    expect(searchMentionGroup(items, 'deploy')[0]?.item.id).toBe('near')
  })

  it('limits the rows of a large group', () => {
    const many: MentionObject[] = Array.from({ length: 300 }, (_, i) => ({
      kind: 'session',
      id: `s${i}`,
      name: `Session ${i}`,
      detail: 'Acme',
      likely: false,
      recency: i,
    }))
    expect(searchMentionGroup(many, '')).toHaveLength(5)
    expect(searchMentionGroup(many, 'session')).toHaveLength(8)
    // Browsing shows the newest first.
    expect(searchMentionGroup(many, '')[0]?.item.id).toBe('s299')
  })
})

describe('orderMentionGroups', () => {
  const scores = { file: 0.3, session: 0.01, agent: 0.2 }

  it('keeps Files first while browsing or for a path', () => {
    expect(orderMentionGroups('', scores)).toEqual(['file', 'session', 'agent'])
    expect(orderMentionGroups('src/app', scores)[0]).toBe('file')
    expect(looksLikePath('App.tsx')).toBe(true)
    expect(looksLikePath('release')).toBe(false)
  })

  it('puts the best match first for a name', () => {
    expect(orderMentionGroups('release', scores)).toEqual([
      'session',
      'agent',
      'file',
    ])
  })
})

describe('mentionMarkdown', () => {
  it.each([
    ['session', 's1', 'Fix login', '[Fix login](splitkick://session/s1)'],
    ['project', 'p1', 'Acme', '[Acme](splitkick://project/p1)'],
    ['worktree', 'w1', 'wt-w1', '[wt-w1](splitkick://worktree/w1)'],
    [
      'agent',
      'a1',
      'Release manager',
      '[Release manager](splitkick://agent/a1)',
    ],
    ['connection', 'c1', 'Mac 2', '[Mac 2](splitkick://connection/c1)'],
  ] as const)('links a %s', (kind, id, name, expected) => {
    expect(
      mentionMarkdown({ kind, id, name, detail: '', likely: true, recency: 0 })
    ).toBe(expected)
  })
})
