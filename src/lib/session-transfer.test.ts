import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, remoteInvokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  remoteInvokeMock: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({ invoke: invokeMock }))
vi.mock('./transport', () => ({ invoke: invokeMock }))
vi.mock('./remote-invoke', () => ({ remoteInvoke: remoteInvokeMock }))

import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import {
  getActiveSessionTarget,
  getTransferTargets,
  transferSession,
} from './session-transfer'

const studio = { id: 'c1', name: 'Studio', url: 'https://a', token: 'x' }
const laptop = { id: 'c2', name: 'Laptop', url: 'https://b', token: 'y' }

describe('session transfer', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    remoteInvokeMock.mockReset()
  })

  it('offers every connection except the current one', () => {
    expect(getTransferTargets([studio, laptop], 'local')).toEqual([
      studio,
      laptop,
    ])
    expect(getTransferTargets([studio, laptop], 'c1')).toEqual([laptop])
  })

  it('exports locally, then imports on the chosen connection', async () => {
    const bundle = { formatVersion: 1 }
    invokeMock.mockResolvedValue(bundle)
    remoteInvokeMock.mockResolvedValue({ id: 'remote-session' })

    const session = await transferSession({
      worktreeId: 'w1',
      sessionId: 's1',
      connection: studio,
      targetWorktreeId: 'rw1',
    })

    expect(session).toEqual({ id: 'remote-session' })
    expect(invokeMock).toHaveBeenCalledWith('export_session_bundle', {
      worktreeId: 'w1',
      sessionId: 's1',
    })
    expect(remoteInvokeMock).toHaveBeenCalledWith(
      studio,
      'import_session_bundle',
      { worktreeId: 'rw1', bundle },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('does not import when the export fails', async () => {
    invokeMock.mockRejectedValue(new Error('Session not found: s1'))

    await expect(
      transferSession({
        worktreeId: 'w1',
        sessionId: 's1',
        connection: studio,
        targetWorktreeId: 'rw1',
      })
    ).rejects.toThrow('Session not found: s1')
    expect(remoteInvokeMock).not.toHaveBeenCalled()
  })

  it('resolves the active session for the palette', () => {
    useUIStore.setState({ sessionChatModalOpen: false })
    useChatStore.setState({
      activeWorktreeId: 'w1',
      activeSessionIds: { w1: 's1' },
    })
    expect(getActiveSessionTarget()).toEqual({
      worktreeId: 'w1',
      sessionId: 's1',
    })

    useChatStore.setState({ activeSessionIds: {} })
    expect(getActiveSessionTarget()).toBeNull()
  })
})
