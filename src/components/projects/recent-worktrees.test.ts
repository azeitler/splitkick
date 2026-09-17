import { describe, expect, it } from 'vitest'
import type { Project, Worktree } from '@/types/projects'
import type { WorktreeSessions } from '@/types/chat'
import { buildRecentWorktreeRows } from './recent-worktrees'

const project = (id: string, name: string): Project =>
  ({ id, name, path: `/${id}`, order: 0 }) as Project

const worktree = (id: string, projectId: string): Worktree =>
  ({
    id,
    project_id: projectId,
    name: id,
    path: `/${projectId}/${id}`,
    branch: id,
    created_at: 1,
    order: 0,
  }) as Worktree

const sessions = (worktreeId: string, activity: number): WorktreeSessions => ({
  worktree_id: worktreeId,
  active_session_id: null,
  version: 2,
  sessions: [
    {
      id: `${worktreeId}-session`,
      name: 'Session',
      order: 0,
      created_at: 1,
      updated_at: activity,
      last_message_at: activity,
      messages: [],
    },
  ],
})

describe('recent worktrees', () => {
  it('sorts worktrees across projects by latest prompt activity', () => {
    const first = worktree('first', 'p1')
    const second = worktree('second', 'p2')

    const rows = buildRecentWorktreeRows(
      [project('p1', 'One'), project('p2', 'Two')],
      new Map([
        ['p1', [first]],
        ['p2', [second]],
      ]),
      new Map([
        ['first', sessions('first', 10)],
        ['second', sessions('second', 20)],
      ])
    )

    expect(rows.map(row => row.worktree.id)).toEqual(['second', 'first'])
  })

  it('includes cached Git diff totals', () => {
    const changed = {
      ...worktree('changed', 'p1'),
      cached_uncommitted_added: 3,
      cached_uncommitted_removed: 2,
      cached_branch_diff_added: 5,
      cached_branch_diff_removed: 1,
    }

    const [row] = buildRecentWorktreeRows(
      [project('p1', 'One')],
      new Map([['p1', [changed]]]),
      new Map([['changed', sessions('changed', 10)]])
    )

    expect(row).toMatchObject({ added: 8, removed: 3 })
  })

  it('omits worktrees that have never been prompted', () => {
    const untouched = worktree('untouched', 'p1')
    const emptySessions = sessions('untouched', 10)
    const originalSession = emptySessions.sessions[0]
    if (!originalSession) throw new Error('Expected test session')
    emptySessions.sessions[0] = {
      ...originalSession,
      last_message_at: undefined,
      updated_at: 10,
      messages: [],
      message_count: 0,
    }

    expect(
      buildRecentWorktreeRows(
        [project('p1', 'One')],
        new Map([['p1', [untouched]]]),
        new Map([['untouched', emptySessions]])
      )
    ).toEqual([])
  })
})
