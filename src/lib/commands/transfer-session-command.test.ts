import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandContext } from './types'

const { isNativeApp, connections } = vi.hoisted(() => ({
  isNativeApp: vi.fn(() => true),
  connections: {
    list: [] as { id: string; name: string; url: string; token: string }[],
  },
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isNativeApp,
}))
vi.mock('@/lib/remote-connections', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveConnectionId: () => 'local',
  getRemoteConnections: () => connections.list,
}))

const { projectCommands } = await import('./project-commands')
const { useChatStore } = await import('@/store/chat-store')
const { useUIStore } = await import('@/store/ui-store')

const command = projectCommands.find(
  item => item.id === 'transfer-session-to-remote'
)
if (!command) throw new Error('transfer command not registered')

function context(hasActiveSession: boolean): CommandContext {
  return {
    hasActiveSession: () => hasActiveSession,
  } as unknown as CommandContext
}

describe('Transfer Session palette command', () => {
  beforeEach(() => {
    isNativeApp.mockReturnValue(true)
    connections.list = [{ id: 'studio', name: 'Studio', url: 'u', token: 't' }]
    useUIStore.setState({
      transferSessionTarget: null,
      sessionChatModalOpen: false,
    })
  })

  it('is available with an active session and another connection', () => {
    expect(command.isAvailable?.(context(true))).toBe(true)
    expect(command.isAvailable?.(context(false))).toBe(false)

    connections.list = []
    expect(command.isAvailable?.(context(true))).toBe(false)

    connections.list = [{ id: 'studio', name: 'Studio', url: 'u', token: 't' }]
    // Web Access too: the target can allow this origin (CORS).
    isNativeApp.mockReturnValue(false)
    expect(command.isAvailable?.(context(true))).toBe(true)
  })

  it('opens the dialog for the active session', async () => {
    useChatStore.setState({
      activeWorktreeId: 'w1',
      activeSessionIds: { w1: 's1' },
    })

    await command.execute(context(true))

    expect(useUIStore.getState().transferSessionTarget).toEqual({
      worktreeId: 'w1',
      sessionId: 's1',
    })
  })
})
