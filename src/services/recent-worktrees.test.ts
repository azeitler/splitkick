import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, RecentWorktreesResponse } from '@/types/projects'
import { fetchRecentWorktrees } from './projects'

const invokeForServer = vi.hoisted(() => vi.fn())
vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal()),
  invokeForServer,
}))

const project = (id: string, serverId?: string): Project =>
  ({
    id: serverId ? `${serverId}:${id}` : id,
    resourceId: serverId ? id : undefined,
    serverId,
    name: id,
    path: `/${id}`,
    default_branch: 'main',
    added_at: 1,
    order: 0,
  }) as Project

const response = (
  serverId: string,
  id: string,
  activity: number,
  total = 1
): RecentWorktreesResponse => ({
  total,
  failedWorktreeIds: [],
  items: [
    {
      projectId: `${serverId}:${id}`,
      projectName: id,
      lastActivityAt: activity,
      added: 1,
      removed: 2,
      worktree: {
        id: `${serverId}:wt-${id}`,
        project_id: `${serverId}:${id}`,
        name: `wt-${id}`,
        path: `/wt-${id}`,
        branch: id,
        created_at: activity,
        order: 0,
      },
      session: {
        id: `${serverId}:session-${id}`,
        name: id,
        order: 0,
        created_at: activity,
        updated_at: activity,
        messages: [],
      },
    },
  ],
})

describe('fetchRecentWorktrees', () => {
  beforeEach(() => invokeForServer.mockReset())

  it('queries once per server and merges rows by activity', async () => {
    invokeForServer.mockImplementation((serverId: string) =>
      Promise.resolve(
        serverId === 'remote'
          ? response('remote', 'remote-project', 20)
          : response('local', 'local-project', 10)
      )
    )

    const result = await fetchRecentWorktrees(
      [project('local-project'), project('remote-project', 'remote')],
      10,
      null
    )

    expect(invokeForServer).toHaveBeenCalledTimes(2)
    expect(result.items.map(item => item.projectName)).toEqual([
      'remote-project',
      'local-project',
    ])
  })

  it('keeps successful server rows when another server fails', async () => {
    invokeForServer.mockImplementation((serverId: string) =>
      serverId === 'remote'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(response('local', 'local-project', 10))
    )

    const result = await fetchRecentWorktrees(
      [project('local-project'), project('remote-project', 'remote')],
      10,
      null
    )

    expect(result.items).toHaveLength(1)
    expect(result.failedServerIds).toEqual(['remote'])
  })

  it('keeps separate recent sessions from the same worktree', async () => {
    const data = response('local', 'project', 20, 2)
    const first = data.items[0]!
    data.items.push({
      ...first,
      lastActivityAt: 10,
      session: { ...first.session, id: 'session-older', name: 'Older session' },
    })
    invokeForServer.mockResolvedValue(data)

    const result = await fetchRecentWorktrees([project('project')], 10, null)

    expect(result.items.map(item => item.session.name)).toEqual([
      'project',
      'Older session',
    ])
  })
})
