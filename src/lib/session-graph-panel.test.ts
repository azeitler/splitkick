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

const panel = () => {
  const { fileBrowserVisible, contextPanelTab } = useUIStore.getState()
  return fileBrowserVisible ? contextPanelTab : null
}

function reset() {
  toastInfo.mockReset()
  useUIStore.setState({
    sessionChatModalOpen: false,
    fileBrowserVisible: false,
    contextPanelTab: 'files',
  })
  useChatStore.setState({
    activeWorktreeId: 'w1',
    activeSessionIds: { w1: 's1' },
  })
}

describe('toggleActiveSessionGraphPanel (#84, #98)', () => {
  beforeEach(reset)

  it('opens and closes the Graph tab of the left panel', () => {
    const queryClient = seed({ serves: ['g1#n1'] })

    toggleActiveSessionGraphPanel(queryClient)
    expect(panel()).toBe('graph')
    toggleActiveSessionGraphPanel(queryClient)
    expect(panel()).toBeNull()
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('switches an open Files panel to the Graph tab', () => {
    useUIStore.setState({ fileBrowserVisible: true, contextPanelTab: 'files' })
    toggleActiveSessionGraphPanel(seed({ agent_id: 'a1' }))
    expect(panel()).toBe('graph')
  })

  it('opens the tab for an unlinked session: the tab offers the link', () => {
    toggleActiveSessionGraphPanel(seed({ serves: [] }))
    expect(panel()).toBe('graph')
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('opens on a phone too: the drawer has the same tabs', () => {
    window.innerWidth = 390
    toggleActiveSessionGraphPanel(seed({ serves: ['g1#n1'] }))
    expect(panel()).toBe('graph')
    window.innerWidth = 1280
  })

  it('explains itself without a session', () => {
    useChatStore.setState({ activeSessionIds: {} })
    toggleActiveSessionGraphPanel(new QueryClient())
    expect(panel()).toBeNull()
    expect(toastInfo).toHaveBeenCalledWith('Open a session to see its graph.')
  })

  it('uses the session of the open session window', () => {
    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'w1',
    })
    useChatStore.setState({ activeWorktreeId: null })

    toggleActiveSessionGraphPanel(seed({ serves: ['g1'] }))
    expect(panel()).toBe('graph')
  })
})

describe('Toggle Graph Panel palette command (#84, #98)', () => {
  const context = (
    hasActiveSession: boolean,
    queryClient = new QueryClient()
  ) =>
    ({
      hasActiveSession: () => hasActiveSession,
      queryClient,
    }) as unknown as CommandContext

  beforeEach(reset)

  it('is listed only when a session is open', () => {
    expect(command.isAvailable?.(context(true))).toBe(true)
    expect(command.isAvailable?.(context(false))).toBe(false)
  })

  it('opens the Graph tab', async () => {
    await command.execute(context(true, seed({ serves: ['g1#n1'] })))
    expect(panel()).toBe('graph')
  })
})
