import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, navigateToSession, cleanupTerminal, invalidateQueries } =
  vi.hoisted(() => ({
    invoke: vi.fn(),
    navigateToSession: vi.fn(),
    cleanupTerminal: vi.fn(),
    invalidateQueries: vi.fn(),
  }))

vi.mock('@/lib/transport', () => ({ invoke }))
vi.mock('@/lib/navigate-to-session', () => ({ navigateToSession }))
vi.mock('@/lib/query-client', () => ({ queryClient: { invalidateQueries } }))
vi.mock('@/services/chat', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cleanupSessionTerminalForRemovedSession: cleanupTerminal,
}))

import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { handleSessionMoved, moveSession } from './session-move'

const sameProject = {
  sessionId: 's1',
  sourceWorktreeId: 'w-a',
  sourceProjectId: 'p-1',
  targetWorktreeId: 'w-b',
  targetProjectId: 'p-1',
}
const otherProject = { ...sameProject, targetProjectId: 'p-2' }

describe('handleSessionMoved', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      sessionWorktreeMap: { s1: 'w-a', s2: 'w-a' },
      activeSessionIds: { 'w-a': 's1', 'w-c': 's3' },
      lastOpenedPerProject: { 'p-1': { worktreeId: 'w-a', sessionId: 's1' } },
    })
    useProjectsStore.setState({
      projectCanvasSettings: {
        'p-1': { pinnedSessions: [{ sessionId: 's1', worktreeId: 'w-a' }] },
      },
    })
  })

  it('points the session at its new worktree and clears the old tab', () => {
    handleSessionMoved(sameProject)

    const chat = useChatStore.getState()
    expect(chat.sessionWorktreeMap).toEqual({ s1: 'w-b', s2: 'w-a' })
    expect(chat.activeSessionIds).toEqual({ 'w-c': 's3' })
  })

  it('keeps the pin and last-opened entry in the same project', () => {
    handleSessionMoved(sameProject)

    expect(
      useProjectsStore.getState().projectCanvasSettings['p-1']?.pinnedSessions
    ).toEqual([{ sessionId: 's1', worktreeId: 'w-b' }])
    expect(useChatStore.getState().lastOpenedPerProject).toEqual({
      'p-1': { worktreeId: 'w-b', sessionId: 's1' },
    })
  })

  it('moves the pin and drops last-opened across projects', () => {
    handleSessionMoved(otherProject)

    const settings = useProjectsStore.getState().projectCanvasSettings
    expect(settings['p-1']?.pinnedSessions).toEqual([])
    expect(settings['p-2']?.pinnedSessions).toEqual([
      { sessionId: 's1', worktreeId: 'w-b' },
    ])
    expect(useChatStore.getState().lastOpenedPerProject).toEqual({})
  })

  it('closes the session terminal in the old folder', () => {
    handleSessionMoved(sameProject)

    expect(cleanupTerminal).toHaveBeenCalledWith('w-a', 's1')
  })
})

describe('moveSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('moves through the backend and opens the session in its new place', async () => {
    invoke.mockResolvedValue({
      sessionId: 's1',
      sourceWorktreeId: 'w-a',
      targetWorktreeId: 'w-b',
      targetProjectId: 'p-2',
      status: 'moved',
    })

    await moveSession('s1', 'w-b')

    expect(invoke).toHaveBeenCalledWith('move_session', {
      sessionId: 's1',
      targetWorktreeId: 'w-b',
    })
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'p-2',
      worktreeId: 'w-b',
      sessionId: 's1',
    })
  })

  // A stale target list without the session makes ChatWindow fall back to the
  // first tab, and the next message goes to the wrong session.
  it('refreshes the target session list before it opens the session', async () => {
    const order: string[] = []
    invalidateQueries.mockImplementation(async () => {
      order.push('refetch')
    })
    navigateToSession.mockImplementation(() => order.push('navigate'))
    invoke.mockResolvedValue({
      sessionId: 's1',
      sourceWorktreeId: 'w-a',
      targetWorktreeId: 'w-b',
      targetProjectId: 'p-2',
      status: 'moved',
    })

    await moveSession('s1', 'w-b')

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['chat', 'sessions', 'w-b'],
      refetchType: 'all',
    })
    expect(order).toEqual(['refetch', 'navigate'])
  })

  it('does not navigate when the backend refuses', async () => {
    invoke.mockRejectedValue('Session is running')

    await expect(moveSession('s1', 'w-b')).rejects.toBe('Session is running')
    expect(navigateToSession).not.toHaveBeenCalled()
  })
})
