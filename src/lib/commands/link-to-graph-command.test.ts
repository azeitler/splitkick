import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { Session, WorktreeSessions } from '@/types/chat'
import { graphCommands } from './graph-commands'
import type { CommandContext } from './types'

const command = graphCommands.find(item => item.id === 'graphs.link-session')
if (!command) throw new Error('link-to-graph command not registered')

function context(
  hasActiveSession: boolean,
  queryClient = new QueryClient()
): CommandContext {
  return {
    hasActiveSession: () => hasActiveSession,
    queryClient,
  } as unknown as CommandContext
}

describe('Link to Graph… palette command (#88)', () => {
  beforeEach(() => {
    useUIStore.setState({
      linkToGraphTarget: null,
      sessionChatModalOpen: false,
    })
    useChatStore.setState({
      activeWorktreeId: 'w1',
      activeSessionIds: { w1: 's1' },
    })
  })

  it('is labelled and available with an active session', () => {
    expect(command.label).toBe('Link to Graph…')
    expect(command.isAvailable?.(context(true))).toBe(true)
    expect(command.isAvailable?.(context(false))).toBe(false)
  })

  it('opens the picker for the active session, also without a link', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<WorktreeSessions>(chatQueryKeys.sessions('w1'), {
      worktree_id: 'w1',
      sessions: [{ id: 's1', name: 'One' } as Session],
      active_session_id: 's1',
      version: 2,
    })

    await command.execute(context(true, queryClient))

    expect(useUIStore.getState().linkToGraphTarget).toEqual({
      sessionId: 's1',
      sessionName: 'One',
      serves: [],
    })
  })
})
