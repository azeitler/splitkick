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
  prefetchSessions,
  reconnectNativeCliSession,
  useAllSessions,
} from './chat'
import { invoke } from '@/lib/transport'
import { preserveQueryCacheOnError } from '@/lib/query-error'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { useTerminalStore } from '@/store/terminal-store'
import { toast } from 'sonner'
import { disposeTerminal } from '@/lib/terminal-instances'
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

describe('useAllSessions', () => {
  it('copies persisted labels into the store (web access never prefetches)', async () => {
    useChatStore.setState({
      sessionLabels: { kept: { name: 'Old', color: '#000000' } },
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
            { id: 'kept' },
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
    // A session without a persisted label keeps what the store has.
    expect(labels.kept).toEqual({ name: 'Old', color: '#000000' })
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
