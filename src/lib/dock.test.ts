import { describe, expect, it } from 'vitest'
import { buildDockSessions, countUnreadSessions } from './dock'
import type { AllSessionsResponse, Session } from '@/types/chat'

function session(overrides: Partial<Session>): Session {
  return {
    id: 'id',
    name: 'Session',
    updated_at: 100,
    ...overrides,
  } as Session
}

function sessions(list: Session[], project = 'jean'): AllSessionsResponse {
  return {
    entries: [
      {
        project_id: `p-${project}`,
        project_name: project,
        worktree_id: 'wt-1',
        worktree_name: 'main',
        worktree_path: '/tmp/main',
        sessions: list,
      },
    ],
  } as AllSessionsResponse
}

describe('dock data', () => {
  const unreadWaiting = session({
    id: 'waiting',
    name: 'Fix login',
    waiting_for_input: true,
    updated_at: 50,
  })
  const unreadDone = session({
    id: 'done',
    name: 'Refactor',
    last_run_status: 'completed',
    updated_at: 90,
  })
  const readRecent = session({
    id: 'recent',
    name: 'Docs',
    last_run_status: 'completed',
    updated_at: 10,
    last_opened_at: 80,
  })
  const readOld = session({
    id: 'old',
    name: 'Old',
    last_run_status: 'completed',
    updated_at: 10,
    last_opened_at: 20,
  })
  const archived = session({
    id: 'archived',
    waiting_for_input: true,
    archived_at: 5,
  })
  const neverOpened = session({ id: 'never' })

  const data = sessions([
    readOld,
    unreadWaiting,
    archived,
    readRecent,
    neverOpened,
    unreadDone,
  ])

  it('counts unread sessions like the title bar bell', () => {
    expect(countUnreadSessions(data)).toBe(2)
    expect(countUnreadSessions(undefined)).toBe(0)
  })

  it('lists unread first by activity, then recently opened', () => {
    expect(buildDockSessions(data).map(s => s.sessionId)).toEqual([
      'done',
      'waiting',
      'recent',
      'old',
    ])
  })

  it('names the project and the reason an unread session waits', () => {
    const [done, waiting, recent] = buildDockSessions(data)
    expect(done?.title).toBe('Refactor — jean · Review ready')
    expect(waiting?.title).toBe('Fix login — jean · Input required')
    expect(recent).toEqual({
      title: 'Docs — jean',
      projectId: 'p-jean',
      worktreeId: 'wt-1',
      sessionId: 'recent',
    })
  })

  it('keeps the menu short', () => {
    expect(buildDockSessions(data, 3)).toHaveLength(3)
  })
})
