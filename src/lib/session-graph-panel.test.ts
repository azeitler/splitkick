import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, WorktreeSessions } from '@/types/chat'
import type { CommandContext } from './commands/types'

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }))
vi.mock('sonner', () => ({ toast: { info: toastInfo } }))

const { toggleActiveSessionGraphPanel } = await import('./session-graph-panel')
const { graphCommands } = await import('./commands/graph-commands')
const { chatQueryKeys } = await import('@/services/chat')
const { useChatStore } = await import('@/store/chat-store')
const { useUIStore } = await import('@/store/ui-store')

const command = graphCommands.find(c => c.id === 'graphs.toggle-session-panel')
if (!command) throw new Error('Toggle Graph Panel command not registered')

function seed(session: Partial<Session>): QueryClient {
  const queryClient = new QueryClient()
  queryClient.setQueryData<WorktreeSessions>(chatQueryKeys.sessions('w1'), {
    worktree_id: 'w1',
    sessions: [{ id: 's1', name: 'One', ...session } as Session],
    active_session_id: 's1',
    version: 2,
  })
  return queryClient
}

describe('toggleActiveSessionGraphPanel (#84)', () => {
  beforeEach(() => {
    toastInfo.mockReset()
    window.innerWidth = 1280
    useUIStore.setState({ sessionChatModalOpen: false })
    useChatStore.setState({
      activeWorktreeId: 'w1',
      activeSessionIds: { w1: 's1' },
      graphPanelVisible: false,
    })
  })

  it('toggles the panel of a session that serves a node', () => {
    const queryClient = seed({ serves: ['g1#n1'] })

    toggleActiveSessionGraphPanel(queryClient)
    expect(useChatStore.getState().graphPanelVisible).toBe(true)
    toggleActiveSessionGraphPanel(queryClient)
    expect(useChatStore.getState().graphPanelVisible).toBe(false)
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('toggles the panel of a session started from an agent', () => {
    toggleActiveSessionGraphPanel(seed({ agent_id: 'a1' }))
    expect(useChatStore.getState().graphPanelVisible).toBe(true)
  })

  it('explains how to link instead of opening an empty panel', () => {
    toggleActiveSessionGraphPanel(seed({ serves: [] }))

    expect(useChatStore.getState().graphPanelVisible).toBe(false)
    expect(toastInfo).toHaveBeenCalledWith(
      'This session does not serve a graph node yet.',
      expect.objectContaining({
        description: expect.stringContaining('Link to Graph…'),
        action: expect.objectContaining({ label: 'Link to Graph…' }),
      })
    )

    const action = toastInfo.mock.calls[0]?.[1]?.action as {
      onClick: () => void
    }
    action.onClick()
    expect(useUIStore.getState().linkToGraphTarget).toEqual({
      sessionId: 's1',
      sessionName: 'One',
      serves: [],
    })
  })

  it('says the panel is desktop-only on a phone', () => {
    window.innerWidth = 390
    toggleActiveSessionGraphPanel(seed({ serves: ['g1#n1'] }))

    expect(useChatStore.getState().graphPanelVisible).toBe(false)
    expect(toastInfo).toHaveBeenCalledWith(
      'The graph panel is only available on desktop.'
    )
  })

  it('uses the session of the open session window', () => {
    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'w1',
    })
    useChatStore.setState({ activeWorktreeId: null })

    toggleActiveSessionGraphPanel(seed({ serves: ['g1'] }))
    expect(useChatStore.getState().graphPanelVisible).toBe(true)
  })
})

describe('Toggle Graph Panel palette command (#84)', () => {
  const context = (
    hasActiveSession: boolean,
    queryClient = new QueryClient()
  ) =>
    ({
      hasActiveSession: () => hasActiveSession,
      queryClient,
    }) as unknown as CommandContext

  beforeEach(() => {
    toastInfo.mockReset()
    window.innerWidth = 1280
    useChatStore.setState({
      activeWorktreeId: 'w1',
      activeSessionIds: { w1: 's1' },
      graphPanelVisible: false,
    })
  })

  it('is listed only when a session is open', () => {
    expect(command.isAvailable?.(context(true))).toBe(true)
    expect(command.isAvailable?.(context(false))).toBe(false)
  })

  it('opens the panel of a linked session', async () => {
    await command.execute(context(true, seed({ serves: ['g1#n1'] })))
    expect(useChatStore.getState().graphPanelVisible).toBe(true)
  })

  it('explains the missing link for an unlinked session', async () => {
    await command.execute(context(true, seed({})))
    expect(useChatStore.getState().graphPanelVisible).toBe(false)
    expect(toastInfo).toHaveBeenCalledWith(
      'This session does not serve a graph node yet.',
      expect.anything()
    )
  })
})
