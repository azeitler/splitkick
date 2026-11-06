import { describe, expect, it } from 'vitest'
import type { ArchivedSessionEntry, Session } from '@/types/chat'
import type { Project, Worktree } from '@/types/projects'
import {
  DEFAULT_ARCHIVED_FILTERS,
  archiveTimeBucket,
  filterArchivedItems,
  groupArchivedItems,
  isArchivedSort,
  toArchivedItems,
} from './archived-items'

// Thursday 2026-11-05, 15:00 local time
const NOW = new Date(2026, 10, 5, 15, 0, 0).getTime()
const at = (y: number, m: number, d: number, h = 12) =>
  Math.floor(new Date(y, m - 1, d, h).getTime() / 1000)

const projects = [
  { id: 'p-web', name: 'website' },
  { id: 'p-app', name: 'app' },
] as Project[]

function worktree(over: Partial<Worktree>): Worktree {
  return {
    id: 'w',
    project_id: 'p-app',
    name: 'wt',
    path: '/tmp/wt',
    branch: 'feature/wt',
    created_at: 0,
    order: 0,
    ...over,
  } as Worktree
}

function session(
  over: Partial<Session> & { id: string; name: string },
  ctx: Partial<ArchivedSessionEntry> = {}
): ArchivedSessionEntry {
  return {
    session: {
      order: 0,
      created_at: 0,
      updated_at: 0,
      messages: [],
      message_count: 3,
      backend: 'claude',
      ...over,
    } as Session,
    worktree_id: 'w-main',
    worktree_name: 'main',
    worktree_path: '/tmp/main',
    project_id: 'p-web',
    project_name: 'website',
    ...ctx,
  }
}

const items = toArchivedItems(
  [
    worktree({
      id: 'w-old',
      name: 'old-branch',
      archived_at: at(2026, 9, 1),
    }),
    worktree({
      id: 'w-merged',
      name: 'login-fix',
      branch: 'fix/login',
      archived_at: at(2026, 11, 5, 9),
      auto_archived_pr_url: 'https://github.com/o/r/pull/1',
    }),
  ],
  [
    session(
      { id: 's-today', name: 'Hero image', archived_at: at(2026, 11, 5, 14) },
      { last_message_preview: 'make the hero image wider' }
    ),
    session({
      id: 's-yday',
      name: 'Bug triage',
      backend: 'codex',
      archived_at: at(2026, 11, 4, 23),
      archived_by_base_close: true,
    }),
    session({ id: 's-week', name: 'Docs', archived_at: at(2026, 10, 31) }),
    session({ id: 's-month', name: 'apple', archived_at: at(2026, 10, 10) }),
  ],
  projects
)

describe('toArchivedItems', () => {
  it('names the project, the reason and the preview', () => {
    const merged = items.find(i => i.id === 'w-merged')
    expect(merged).toMatchObject({ projectName: 'app', reason: 'pr_merged' })
    const yday = items.find(i => i.id === 's-yday')
    expect(yday).toMatchObject({ reason: 'base_closed', backend: 'codex' })
    const today = items.find(i => i.id === 's-today')
    expect(today).toMatchObject({
      preview: 'make the hero image wider',
      messageCount: 3,
    })
  })

  it('marks a worktree with a missing folder', () => {
    const [item] = toArchivedItems(
      [worktree({ auto_archived: true, auto_archived_pr_url: 'x' })],
      [],
      projects
    )
    expect(item?.reason).toBe('folder_missing')
  })
})

describe('archiveTimeBucket', () => {
  it.each([
    [at(2026, 11, 5, 0), 'today'],
    [at(2026, 11, 4, 23), 'yesterday'],
    [at(2026, 11, 4, 0), 'yesterday'],
    [at(2026, 11, 3, 23), 'week'],
    [at(2026, 10, 30, 1), 'week'],
    [at(2026, 10, 29, 23), 'month'],
    [at(2026, 10, 7), 'month'],
    [at(2026, 10, 6, 23), 'older'],
    [0, 'older'],
  ])('%s is %s', (time, bucket) => {
    expect(archiveTimeBucket(time, NOW)).toBe(bucket)
  })

  it('accepts millisecond timestamps', () => {
    expect(archiveTimeBucket(at(2026, 11, 5) * 1000, NOW)).toBe('today')
  })
})

describe('groupArchivedItems', () => {
  it('lists the last archived first, in time buckets', () => {
    const groups = groupArchivedItems(items, 'archived', NOW)
    expect(groups.map(g => g.label)).toEqual([
      'Today',
      'Yesterday',
      'This week',
      'This month',
      'Older',
    ])
    expect(groups[0]?.items.map(i => i.id)).toEqual(['s-today', 'w-merged'])
  })

  it('sorts by name in one section, ignoring case', () => {
    const groups = groupArchivedItems(items, 'name', NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items.map(i => i.name)).toEqual([
      'apple',
      'Bug triage',
      'Docs',
      'Hero image',
      'login-fix',
      'old-branch',
    ])
  })

  it('groups by project A–Z, newest first inside', () => {
    const groups = groupArchivedItems(items, 'project', NOW)
    expect(groups.map(g => g.label)).toEqual(['app', 'website'])
    expect(groups[0]?.items.map(i => i.id)).toEqual(['w-merged', 'w-old'])
    expect(groups[1]?.items.map(i => i.id)).toEqual([
      's-today',
      's-yday',
      's-week',
      's-month',
    ])
  })

  it('returns no sections for no items', () => {
    expect(groupArchivedItems([], 'name', NOW)).toEqual([])
    expect(groupArchivedItems([], 'archived', NOW)).toEqual([])
  })
})

describe('filterArchivedItems', () => {
  const ids = (filters: Partial<typeof DEFAULT_ARCHIVED_FILTERS>) =>
    filterArchivedItems(items, { ...DEFAULT_ARCHIVED_FILTERS, ...filters })
      .map(i => i.id)
      .sort()

  it('keeps everything by default', () => {
    expect(ids({})).toHaveLength(6)
  })

  it('filters by kind', () => {
    expect(ids({ kind: 'worktree' })).toEqual(['w-merged', 'w-old'])
    expect(ids({ kind: 'session' })).toHaveLength(4)
  })

  it('filters by project and backend', () => {
    expect(ids({ projectId: 'p-app' })).toEqual(['w-merged', 'w-old'])
    expect(ids({ backend: 'codex' })).toEqual(['s-yday'])
  })

  it('searches name, branch, project and the last prompt', () => {
    expect(ids({ query: 'HERO IMAGE WIDER' })).toEqual(['s-today'])
    expect(ids({ query: 'fix/login' })).toEqual(['w-merged'])
    expect(ids({ query: 'website', kind: 'session' })).toHaveLength(4)
    expect(ids({ query: '  ' })).toHaveLength(6)
    expect(ids({ query: 'nothing matches' })).toEqual([])
  })

  it('also keeps sessions whose message text matched', () => {
    const matches = new Set(['s-week', 'w-old'])
    const found = filterArchivedItems(
      items,
      { ...DEFAULT_ARCHIVED_FILTERS, query: 'deep in the chat' },
      matches
    )
    // A worktree id in the set does not count: only sessions have messages.
    expect(found.map(i => i.id)).toEqual(['s-week'])
  })
})

describe('isArchivedSort', () => {
  it('accepts only known sorts', () => {
    expect(isArchivedSort('archived')).toBe(true)
    expect(isArchivedSort('project')).toBe(true)
    expect(isArchivedSort('size')).toBe(false)
    expect(isArchivedSort(null)).toBe(false)
  })
})
