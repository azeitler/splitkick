import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
}))

let connectionWindow = false
vi.mock('./remote-connections', () => ({
  isConnectionWindow: () => connectionWindow,
}))

const allSessions = {
  entries: [
    {
      project_id: 'p-1',
      worktree_id: 'wt-1',
      sessions: [{ id: 'session-1' }],
    },
  ],
}
vi.mock('@/lib/query-client', () => ({
  queryClient: {
    getQueryData: (key: unknown[]) =>
      key[0] === 'all-sessions' ? allSessions : undefined,
  },
}))

const sessionTarget = {
  projectId: 'p-1',
  worktreeId: 'wt-1',
  sessionId: 'session-1',
}

vi.mock('@/store/chat-store', () => ({
  useChatStore: {
    getState: () => chatState,
  },
}))

vi.mock('@/store/ui-store', () => ({
  useUIStore: {
    getState: () => uiState,
  },
}))

let chatState: {
  activeWorktreeId: string | null
  activeSessionIds: Record<string, string>
  sessionWorktreeMap: Record<string, string>
}

let uiState: {
  sessionChatModalOpen: boolean
  sessionChatModalWorktreeId: string | null
}

describe('session-notifications', () => {
  beforeEach(() => {
    invoke.mockClear()
    connectionWindow = false
    chatState = {
      activeWorktreeId: 'wt-other',
      activeSessionIds: { 'wt-1': 'session-1', 'wt-other': 'session-other' },
      sessionWorktreeMap: { 'session-1': 'wt-1', 'session-other': 'wt-other' },
    }
    uiState = {
      sessionChatModalOpen: false,
      sessionChatModalWorktreeId: null,
    }
    // Focused window by default
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => true,
    })
  })

  it('notifies when focused on a different session (issue #626)', async () => {
    const { notifySessionNeedsAttention } = await import(
      './session-notifications'
    )
    notifySessionNeedsAttention('session-1', 'Needs your input', 'My session')
    expect(invoke).toHaveBeenCalledWith('send_native_notification', {
      title: 'Needs your input',
      body: 'My session',
      session: sessionTarget,
      requestAttention: false,
    })
  })

  it('skips OS banner when the session is actively viewed and window focused', async () => {
    chatState.activeWorktreeId = 'wt-1'
    const { notifySessionNeedsAttention } = await import(
      './session-notifications'
    )
    notifySessionNeedsAttention('session-1', 'Needs your input', 'My session')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('notifies when window is unfocused even if session is active', async () => {
    chatState.activeWorktreeId = 'wt-1'
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => false,
    })
    const { notifySessionNeedsAttention } = await import(
      './session-notifications'
    )
    notifySessionNeedsAttention('session-1', 'Needs your input', 'My session')
    expect(invoke).toHaveBeenCalledWith('send_native_notification', {
      title: 'Needs your input',
      body: 'My session',
      session: sessionTarget,
      requestAttention: true,
    })
  })

  it('opens the session on click for a background lifecycle banner', async () => {
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => false,
    })
    const { notifyIfBackground } = await import('./session-notifications')
    notifyIfBackground('Session finished', 'My session', 'session-1')
    expect(invoke).toHaveBeenCalledWith('send_native_notification', {
      title: 'Session finished',
      body: 'My session',
      session: sessionTarget,
      requestAttention: false,
    })
  })

  it('sends no session from a connection window (its ids are remote)', async () => {
    connectionWindow = true
    const { notifySessionNeedsAttention } = await import(
      './session-notifications'
    )
    notifySessionNeedsAttention('session-1', 'Needs your input', 'My session')
    expect(invoke).toHaveBeenCalledWith(
      'send_native_notification',
      expect.objectContaining({ session: null })
    )
  })

  it('sends no session when the session is not in the session list', async () => {
    const { notifySessionNeedsAttention } = await import(
      './session-notifications'
    )
    notifySessionNeedsAttention('session-x', 'Needs your input', 'Other')
    expect(invoke).toHaveBeenCalledWith(
      'send_native_notification',
      expect.objectContaining({ session: null })
    )
  })
})
