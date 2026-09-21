import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AllSessionsEntry, Session } from '@/types/chat'
import type { Project } from '@/types/projects'
import { useUIStore } from '@/store/ui-store'

const mocks = vi.hoisted(() => ({ navigateToProject: vi.fn() }))

vi.mock('@/lib/navigate-to-session', () => ({
  navigateToProject: mocks.navigateToProject,
}))

import {
  groupProjectsByFolder,
  hasQueuedSessionOpen,
  openProjectFromTab,
  recentlyOpenedSessions,
} from './mobile-nav-utils'

function session(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...extra,
  } as unknown as Session
}

function entry(sessions: Session[], worktree = 'main'): AllSessionsEntry {
  return {
    project_id: 'p1',
    project_name: 'jean',
    worktree_id: `wt-${worktree}`,
    worktree_name: worktree,
    worktree_path: `/tmp/${worktree}`,
    sessions,
  }
}

function project(id: string, extra: Partial<Project> = {}): Project {
  return { id, name: id, ...extra } as unknown as Project
}

describe('recentlyOpenedSessions', () => {
  it('orders by when a session was opened, not by activity', () => {
    // `busy` has the newest activity, but `visited` was opened last.
    const rows = recentlyOpenedSessions([
      entry([
        session('busy', { last_message_at: 9_000, last_opened_at: 100 }),
        session('visited', { last_message_at: 10, last_opened_at: 500 }),
      ]),
    ])

    expect(rows.map(row => row.session.id)).toEqual(['visited', 'busy'])
  })

  it('leaves out sessions that were never opened', () => {
    // An agent can create a session over MCP that the user never looked at.
    const rows = recentlyOpenedSessions([
      entry([session('opened', { last_opened_at: 5 }), session('never')]),
    ])

    expect(rows.map(row => row.session.id)).toEqual(['opened'])
  })

  it('leaves out archived sessions', () => {
    const rows = recentlyOpenedSessions([
      entry([
        session('live', { last_opened_at: 5 }),
        session('gone', { last_opened_at: 9, archived_at: 10 }),
      ]),
    ])

    expect(rows.map(row => row.session.id)).toEqual(['live'])
  })

  it('shows the open time, the time the list is ordered by', () => {
    const [row] = recentlyOpenedSessions([
      entry([session('s', { last_message_at: 1, last_opened_at: 1_700 })]),
    ])

    // Unix seconds, normalised to milliseconds for the relative-time label.
    expect(row?.activityAt).toBe(1_700_000)
  })
})

describe('groupProjectsByFolder', () => {
  it('puts root projects first, then one heading per folder', () => {
    const groups = groupProjectsByFolder([
      project('work', { is_folder: true }),
      project('acme', { parent_id: 'work' }),
      project('jean'),
    ])

    expect(groups).toEqual([
      { id: 'root', title: null, projects: [project('jean')] },
      {
        id: 'work',
        title: 'work',
        projects: [project('acme', { parent_id: 'work' })],
      },
    ])
  })

  it('names a nested folder by its full path', () => {
    const groups = groupProjectsByFolder([
      project('clients', { is_folder: true }),
      project('acme', { is_folder: true, parent_id: 'clients' }),
      project('site', { parent_id: 'acme' }),
    ])

    expect(groups.map(group => group.title)).toEqual(['clients / acme'])
  })

  it('drops folders without projects', () => {
    const groups = groupProjectsByFolder([
      project('empty', { is_folder: true }),
      project('jean'),
    ])

    expect(groups.map(group => group.id)).toEqual(['root'])
  })

  it('survives a folder cycle in hand-edited data', () => {
    const groups = groupProjectsByFolder([
      project('a', { is_folder: true, parent_id: 'b' }),
      project('b', { is_folder: true, parent_id: 'a' }),
      project('p', { parent_id: 'a' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.projects.map(p => p.id)).toEqual(['p'])
  })
})

describe('the entry of the project layer', () => {
  beforeEach(() => {
    useUIStore.setState({
      autoOpenSessionWorktreeIds: new Set(),
      pendingAutoOpenSessionIds: {},
      pendingProjectHomeId: null,
    })
    mocks.navigateToProject.mockClear()
  })

  it('reads a queued session open as a push', () => {
    expect(hasQueuedSessionOpen()).toBe(false)
    useUIStore.getState().markWorktreeForAutoOpenSession('wt-1', 's-1')
    expect(hasQueuedSessionOpen()).toBe(true)
  })

  it('opens a project on its own home page, not its last session', () => {
    openProjectFromTab('p1')

    expect(mocks.navigateToProject).toHaveBeenCalledWith('p1')
    expect(useUIStore.getState().pendingProjectHomeId).toBe('p1')
    // A project open queues no session, so the layer rises as a modal.
    expect(hasQueuedSessionOpen()).toBe(false)
  })
})
