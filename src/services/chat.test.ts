import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  hasBackend: () => true,
  hasBackendTransport: () => true,
}))

vi.mock('@/lib/terminal-instances', () => ({
  disposeTerminal: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import {
  canReconnectSession,
  mergeFetchedSession,
  prefetchSessions,
  reconnectNativeCliSession,
  refreshWorktreeSessionsCaches,
  useAllSessions,
  useSendMessage,
} from './chat'
import { invoke } from '@/lib/transport'
import { preserveQueryCacheOnError } from '@/lib/query-error'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { useTerminalStore } from '@/store/terminal-store'
import { toast } from 'sonner'
import { disposeTerminal } from '@/lib/terminal-instances'
import { isSessionStateHydrating } from '@/lib/session-state-hydration'
import type { Session } from '@/types/chat'

const toastMock = toast as unknown as {
  success: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

describe('transient WebSocket query failures', () => {
  it('rethrows disconnects so TanStack Query preserves cached session data', () => {
    const error = new Error('WebSocket disconnected')

    expect(() => preserveQueryCacheOnError(error)).toThrow(error)
  })

  it('does not convert other load failures into empty session data', () => {
    const error = new Error('session file is invalid')

    expect(() => preserveQueryCacheOnError(error)).toThrow(error)
  })
})

describe('prefetchSessions', () => {
  beforeEach(() => {
    ;(window as unknown as Record<string, unknown>).__JEAN_E2E_MOCK__ = true
    useChatStore.setState({
      sessionWorktreeMap: {},
      worktreePaths: {},
      reviewingSessions: {},
      waitingForInputSessionIds: {},
      executionModes: {},
      sessionLabels: {},
      reviewResults: {},
      answeredQuestions: {},
      submittedAnswers: {},
      fixedReviewFindings: {},
    })
  })

  it('hydrates answered question state and submitted answers from prefetched sessions', async () => {
    const { invoke } = await import('@/lib/transport')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      worktree_id: 'wt-1',
      sessions: [
        {
          id: 'session-1',
          name: 'Session 1',
          order: 0,
          created_at: 1,
          updated_at: 1,
          messages: [],
          version: 2,
          answered_questions: ['tool-1'],
          submitted_answers: {
            'tool-1': [{ questionIndex: 0, selectedOptions: [1] }],
          },
          fixed_findings: [],
          waiting_for_input: false,
        },
      ],
      active_session_id: 'session-1',
      version: 2,
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    await prefetchSessions(queryClient, 'wt-1', '/tmp/wt-1')

    const state = useChatStore.getState()
    expect(state.sessionWorktreeMap['session-1']).toBe('wt-1')
    expect(state.answeredQuestions['session-1']?.has('tool-1')).toBe(true)
    expect(state.submittedAnswers['session-1']).toEqual({
      'tool-1': [{ questionIndex: 0, selectedOptions: [1] }],
    })
  })
})

describe('useSendMessage duplicate send', () => {
  // The backend still holds the send slot for a few seconds after chat:done
  // (checkpoint finalize). A prompt sent then must run later, not bounce back
  // into the input with no error.
  it('queues a rejected direct submit instead of restoring the input', async () => {
    useChatStore.setState({ inputDrafts: {}, sendingSessionIds: {} })
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'send_chat_message') {
        throw 'Session already has an active request'
      }
      return []
    })
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    const { result } = renderHook(() => useSendMessage(), { wrapper })
    result.current.mutate({
      sessionId: 's1',
      worktreeId: 'w1',
      worktreePath: '/w',
      message: 'Pdf versandbericht ist abgelegt',
      model: 'claude-opus-5-5',
      executionMode: 'yolo',
      thinkingLevel: 'ultrathink',
    })

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'enqueue_message',
        expect.objectContaining({
          worktreeId: 'w1',
          worktreePath: '/w',
          sessionId: 's1',
          message: expect.objectContaining({
            message: 'Pdf versandbericht ist abgelegt',
            model: 'claude-opus-5-5',
            executionMode: 'yolo',
          }),
        })
      )
    )
    expect(useChatStore.getState().inputDrafts.s1).toBeUndefined()
  })
})

describe('useSendMessage refused send', () => {
  it('shows the error and puts the prompt back into the input', async () => {
    useChatStore.setState({
      inputDrafts: {},
      errors: {},
      lastSentMessages: { s1: 'hello' },
    })
    const refusal =
      'macOS does not let Splitkick read the worktree folder /w. Restart Splitkick.'
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'send_chat_message') throw refusal
      return []
    })
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    const { result } = renderHook(() => useSendMessage(), { wrapper })
    result.current.mutate({
      sessionId: 's1',
      worktreeId: 'w1',
      worktreePath: '/w',
      message: 'hello',
    })

    await waitFor(() => expect(useChatStore.getState().errors.s1).toBe(refusal))
    expect(useChatStore.getState().inputDrafts.s1).toBe('hello')
    expect(useChatStore.getState().lastSentMessages.s1).toBeUndefined()
  })
})

describe('useAllSessions', () => {
  it('copies persisted labels into the store (web access never prefetches)', async () => {
    useChatStore.setState({
      sessionLabels: {
        cleared: { name: 'Old', color: '#000000' },
        elsewhere: { name: 'Other', color: '#111111' },
      },
    })
    vi.mocked(invoke).mockResolvedValueOnce({
      entries: [
        {
          project_id: 'p1',
          project_name: 'p',
          worktree_id: 'w1',
          worktree_name: 'w',
          worktree_path: '/w',
          sessions: [
            { id: 'labeled', label: { name: 'Needs QA', color: '#e11d48' } },
            { id: 'cleared' },
          ],
        },
      ],
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    const { result } = renderHook(() => useAllSessions(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const labels = useChatStore.getState().sessionLabels
    expect(labels.labeled).toEqual({ name: 'Needs QA', color: '#e11d48' })
    // The response is the truth for its sessions: no label means cleared.
    expect(labels.cleared).toBeUndefined()
    // A session the response does not carry keeps its label.
    expect(labels.elsewhere).toEqual({ name: 'Other', color: '#111111' })
  })
})

describe('outside session label changes', () => {
  const worktreeSessions = (label?: { name: string; color: string }) => ({
    worktree_id: 'w1',
    sessions: [{ id: 's1', name: 'Session 1', label }],
    active_session_id: 's1',
    version: 2,
  })

  it('reach sessionLabels through the scoped sessions refresh', async () => {
    useChatStore.setState({ sessionLabels: {} })
    const client = new QueryClient()
    const hydrating: boolean[] = []
    const unsubscribe = useChatStore.subscribe(() =>
      hydrating.push(isSessionStateHydrating())
    )

    // An agent sets the label (MCP set_session_label), then changes it.
    vi.mocked(invoke).mockResolvedValueOnce(
      worktreeSessions({ name: 'Social', color: '#eab308' })
    )
    await refreshWorktreeSessionsCaches(client, 'w1', '/w1')
    expect(useChatStore.getState().sessionLabels.s1).toEqual({
      name: 'Social',
      color: '#eab308',
    })

    vi.mocked(invoke).mockResolvedValueOnce(
      worktreeSessions({ name: 'Social', color: '#ec4899' })
    )
    await refreshWorktreeSessionsCaches(client, 'w1', '/w1')
    expect(useChatStore.getState().sessionLabels.s1?.color).toBe('#ec4899')

    // The same label again changes nothing in the store.
    const before = useChatStore.getState().sessionLabels
    vi.mocked(invoke).mockResolvedValueOnce(
      worktreeSessions({ name: 'Social', color: '#ec4899' })
    )
    await refreshWorktreeSessionsCaches(client, 'w1', '/w1')
    expect(useChatStore.getState().sessionLabels).toBe(before)

    // The agent clears it.
    vi.mocked(invoke).mockResolvedValueOnce(worktreeSessions())
    await refreshWorktreeSessionsCaches(client, 'w1', '/w1')
    expect(useChatStore.getState().sessionLabels.s1).toBeUndefined()

    unsubscribe()
    // Written as hydration, so the immediate-save hook does not echo it back.
    expect(hydrating).toEqual([true, true, true])
  })
})

describe('reconnectNativeCliSession', () => {
  const terminalSession: Session = {
    id: 'session-1',
    name: 'Claude',
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    version: 2,
    backend: 'claude',
    claude_session_id: 'abc123',
    primary_surface: 'terminal',
    terminal_command: '/usr/local/bin/claude',
    terminal_label: 'Claude',
  } as Session

  beforeEach(async () => {
    toastMock.success.mockClear()
    toastMock.error.mockClear()
    ;(disposeTerminal as ReturnType<typeof vi.fn>).mockClear()
    ;(disposeTerminal as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const { invoke } = await import('@/lib/transport')
    ;(invoke as ReturnType<typeof vi.fn>).mockClear()
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    useUIStore.setState({ sessionPrimarySurface: {}, sessionTerminalIds: {} })
    useTerminalStore.setState({ terminals: {}, modalTerminalOpen: {} })
    // reconnectNativeCliSession calls setActiveSession; isolate the chat-store
    // from the neighbouring describe block.
    useChatStore.setState({ activeSessionIds: {}, sessionWorktreeMap: {} })
  })

  it('relaunches the terminal and restores the terminal surface', async () => {
    await reconnectNativeCliSession(terminalSession, 'wt-1')

    const ui = useUIStore.getState()
    expect(ui.sessionPrimarySurface['session-1']).toBe('terminal')
    const terminalId = ui.sessionTerminalIds['session-1']
    expect(terminalId).toBeDefined()

    const terminal = useTerminalStore
      .getState()
      .terminals['wt-1']?.find(t => t.id === terminalId)
    // Resumes the same Claude conversation via --resume <id>.
    expect(terminal?.command).toBe('/usr/local/bin/claude')
    expect(terminal?.commandArgs).toEqual(['--resume', 'abc123'])
  })

  it('preserves native CLI global flags when resuming', async () => {
    await reconnectNativeCliSession(
      {
        ...terminalSession,
        terminal_command_args: [
          '--permission-mode',
          'bypassPermissions',
          '--session-id',
          'abc123',
        ],
      },
      'wt-1'
    )

    const terminalId = useUIStore.getState().sessionTerminalIds['session-1']
    const terminal = useTerminalStore
      .getState()
      .terminals['wt-1']?.find(t => t.id === terminalId)
    expect(terminal?.commandArgs).toEqual([
      '--permission-mode',
      'bypassPermissions',
      '--resume',
      'abc123',
    ])
  })

  it('refuses to reconnect native sessions without a persisted resume ID', () => {
    expect(
      canReconnectSession({
        ...terminalSession,
        claude_session_id: undefined,
        terminal_command_args: ['--permission-mode', 'bypassPermissions'],
      })
    ).toBe(false)
  })

  it('opens the modal drawer and toasts by default (manual reconnect)', async () => {
    await reconnectNativeCliSession(terminalSession, 'wt-1')

    expect(useTerminalStore.getState().modalTerminalOpen['wt-1']).toBe(true)
    expect(toastMock.success).toHaveBeenCalledTimes(1)
  })

  it('stays silent and inline when openModal/showToast are false (startup auto-restore)', async () => {
    await reconnectNativeCliSession(terminalSession, 'wt-1', {
      openModal: false,
      showToast: false,
      markOpened: false,
    })

    // Terminal still restored...
    expect(useUIStore.getState().sessionTerminalIds['session-1']).toBeDefined()
    // ...but no floating drawer pops and no toast fires.
    expect(
      useTerminalStore.getState().modalTerminalOpen['wt-1']
    ).toBeUndefined()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('does not mark the session opened when markOpened is false', async () => {
    const { invoke } = await import('@/lib/transport')

    await reconnectNativeCliSession(terminalSession, 'wt-1', {
      openModal: false,
      showToast: false,
      markOpened: false,
    })

    expect(invoke).not.toHaveBeenCalledWith('set_session_last_opened', {
      sessionId: 'session-1',
    })
  })

  it('marks the session opened by default (manual reconnect)', async () => {
    const { invoke } = await import('@/lib/transport')

    await reconnectNativeCliSession(terminalSession, 'wt-1')

    expect(invoke).toHaveBeenCalledWith('set_session_last_opened', {
      sessionId: 'session-1',
    })
  })

  it('keeps the Jean session id when reconnecting a native CLI terminal', async () => {
    await reconnectNativeCliSession(terminalSession, 'wt-1', {
      openModal: false,
      showToast: false,
    })

    expect(useTerminalStore.getState().terminals['wt-1']?.[0]?.sessionId).toBe(
      'session-1'
    )
  })

  it('continues reconnecting when old terminal disposal fails', async () => {
    useUIStore.setState({
      sessionPrimarySurface: {},
      sessionTerminalIds: { 'session-1': 'old-terminal' },
    })
    useTerminalStore.setState({
      terminals: {
        'wt-1': [
          {
            id: 'old-terminal',
            worktreeId: 'wt-1',
            label: 'Old Terminal',
            command: 'claude',
          },
        ],
      },
      modalTerminalOpen: {},
    })
    ;(disposeTerminal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('already disposed')
    )

    await reconnectNativeCliSession(terminalSession, 'wt-1')

    const terminalId = useUIStore.getState().sessionTerminalIds['session-1']
    expect(terminalId).toBeDefined()
    expect(terminalId).not.toBe('old-terminal')
    expect(
      useTerminalStore
        .getState()
        .terminals['wt-1']?.some(terminal => terminal.id === 'old-terminal')
    ).toBe(false)
  })
})

describe('formatAnswersForClaude', () => {
  const questions = [
    {
      question: 'Which cache backend?',
      options: [{ label: 'Redis' }, { label: 'Memcached' }],
    },
    {
      question: 'Which features?',
      options: [{ label: 'TTL' }, { label: 'Pub/Sub' }],
      multiSelect: true,
    },
  ] as never

  it('keys answers by question text, as AskUserQuestion expects', async () => {
    const { formatAnswersForClaude } = await import('./chat')
    expect(
      formatAnswersForClaude(questions, [
        { questionIndex: 0, selectedOptions: [1] },
      ])
    ).toEqual({ 'Which cache backend?': 'Memcached' })
  })

  it('joins multi-select labels with a comma', async () => {
    const { formatAnswersForClaude } = await import('./chat')
    expect(
      formatAnswersForClaude(questions, [
        { questionIndex: 1, selectedOptions: [0, 1] },
      ])
    ).toEqual({ 'Which features?': 'TTL, Pub/Sub' })
  })

  it('prefers freeform text over the selected labels', async () => {
    const { formatAnswersForClaude } = await import('./chat')
    expect(
      formatAnswersForClaude(questions, [
        {
          questionIndex: 0,
          selectedOptions: [0],
          customText: '  neither, use Postgres  ',
        },
      ])
    ).toEqual({ 'Which cache backend?': 'neither, use Postgres' })
  })

  it('omits questions with no answer rather than sending empty strings', async () => {
    const { formatAnswersForClaude } = await import('./chat')
    expect(
      formatAnswersForClaude(questions, [
        { questionIndex: 0, selectedOptions: [] },
        { questionIndex: 9, selectedOptions: [0] },
      ])
    ).toEqual({})
  })
})

describe('mergeFetchedSession', () => {
  const msg = (
    id: string,
    role: 'user' | 'assistant',
    toolCalls: Session['messages'][number]['tool_calls'] = []
  ): Session['messages'][number] => ({
    id,
    session_id: 's',
    role,
    content: id,
    timestamp: 1,
    tool_calls: toolCalls,
  })
  const session = (
    messages: Session['messages'],
    loadedRunStartIndex: number
  ): Session =>
    ({
      id: 's',
      name: 'S',
      order: 0,
      created_at: 1,
      updated_at: 1,
      messages,
      loaded_run_start_index: loadedRunStartIndex,
    }) as Session

  const question = {
    id: 'toolu_ask',
    name: 'AskUserQuestion',
    input: { questions: [] },
  }

  // Issue #73: older runs were loaded by scrolling up, and chat:done left a
  // frontend-built assistant message without the question. The refetch must
  // replace the overlapping runs with the backend copy, not keep the cache.
  it('takes the fresh runs and keeps only the older loaded ones', () => {
    const cached = session(
      [
        msg('u-old', 'user'),
        msg('a-old', 'assistant'),
        msg('u-73', 'user'),
        msg('optimistic', 'assistant'),
      ],
      0
    )
    const fresh = session(
      [msg('u-73', 'user'), msg('a-73', 'assistant', [question])],
      1
    )

    const merged = mergeFetchedSession(cached, fresh, false)

    expect(merged.messages.map(m => m.id)).toEqual([
      'u-old',
      'a-old',
      'u-73',
      'a-73',
    ])
    expect(merged.messages.at(-1)?.tool_calls).toEqual([question])
    expect(merged.loaded_run_start_index).toBe(0)
  })

  it('keeps the cached messages while the session is still sending', () => {
    const cached = session(
      [msg('u-1', 'user'), msg('a-1', 'assistant'), msg('u-2', 'user')],
      0
    )
    const fresh = session([msg('u-1', 'user'), msg('a-1', 'assistant')], 0)

    expect(mergeFetchedSession(cached, fresh, true).messages).toBe(
      cached.messages
    )
  })

  it('returns the fresh session when nothing older is cached', () => {
    const fresh = session([msg('u-1', 'user'), msg('a-1', 'assistant')], 0)

    expect(mergeFetchedSession(undefined, fresh, false)).toBe(fresh)
    expect(
      mergeFetchedSession(session([msg('u-1', 'user')], 0), fresh, false)
    ).toBe(fresh)
  })
})
