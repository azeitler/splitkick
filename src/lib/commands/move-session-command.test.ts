import { beforeEach, describe, expect, it } from 'vitest'
import type { CommandContext } from './types'
import { projectCommands } from './project-commands'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'

const command = projectCommands.find(item => item.id === 'move-session')
if (!command) throw new Error('move command not registered')

function context(hasActiveSession: boolean): CommandContext {
  return {
    hasActiveSession: () => hasActiveSession,
  } as unknown as CommandContext
}

describe('Move Session palette command', () => {
  beforeEach(() => {
    useUIStore.setState({ moveSessionTarget: null, sessionChatModalOpen: false })
  })

  it('is available with an active session', () => {
    expect(command.isAvailable?.(context(true))).toBe(true)
    expect(command.isAvailable?.(context(false))).toBe(false)
  })

  it('opens the dialog for the active session', async () => {
    useChatStore.setState({
      activeWorktreeId: 'w1',
      activeSessionIds: { w1: 's1' },
    })

    await command.execute(context(true))

    expect(useUIStore.getState().moveSessionTarget).toEqual({
      worktreeId: 'w1',
      sessionId: 's1',
    })
  })
})
