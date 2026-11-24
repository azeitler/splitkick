import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import type { Question, Session } from '@/types/chat'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/transport', () => ({ invoke: invokeMock }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}))

import { useMessageHandlers } from './useMessageHandlers'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'

const SESSION = 'session-paused-question'
const QUESTION_ID = 'toolu_paused_question'
const questions: Question[] = [
  {
    header: 'Color',
    question: 'Which color?',
    multiSelect: false,
    options: [{ label: 'Teal' }, { label: 'Amber' }],
  },
]

function setup() {
  const queryClient = new QueryClient()
  queryClient.setQueryData(chatQueryKeys.session(SESSION), {
    id: SESSION,
    backend: 'claude',
    messages: [],
  } as unknown as Session)
  const sendMessage = { mutate: vi.fn() }
  const ref = <T>(current: T) => ({ current })
  const { result } = renderHook(() =>
    useMessageHandlers({
      activeSessionIdRef: ref(SESSION),
      activeWorktreeIdRef: ref('worktree-1'),
      activeWorktreePathRef: ref('/tmp/worktree-1'),
      selectedModelRef: ref('sonnet'),
      buildModelRef: ref(null),
      buildBackendRef: ref(null),
      buildThinkingLevelRef: ref(null),
      buildEffortLevelRef: ref(null),
      yoloModelRef: ref(null),
      yoloBackendRef: ref(null),
      yoloThinkingLevelRef: ref(null),
      yoloEffortLevelRef: ref(null),
      selectedBackendRef: ref('claude'),
      getCustomProfileName: () => undefined,
      executionModeRef: ref('build'),
      selectedThinkingLevelRef: ref('off'),
      selectedEffortLevelRef: ref('medium'),
      useAdaptiveThinkingRef: ref(false),
      getMcpConfig: () => undefined,
      sendMessage,
      createSession: { mutateAsync: vi.fn() },
      queryClient,
      scrollToBottom: vi.fn(),
      markAtBottom: vi.fn(),
      inputRef: ref(null),
      pendingPlanMessage: null,
      projectIdRef: ref(null),
    } as unknown as Parameters<typeof useMessageHandlers>[0])
  )
  return { handlers: result.current, sendMessage }
}

afterEach(() => {
  invokeMock.mockReset()
  const store = useChatStore.getState()
  store.removeSendingSession(SESSION)
  store.setParkedClaudeDialog(SESSION, null)
})

describe('answering a Claude question (#155)', () => {
  it('resumes a paused session with the answer as the next message', async () => {
    // Nothing is parked: the run was paused or ended before the answer.
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'answer_claude_dialog' ? false : undefined)
    )
    const { handlers, sendMessage } = setup()

    handlers.handleQuestionAnswer(
      QUESTION_ID,
      [{ questionIndex: 0, selectedOptions: [0] }],
      questions
    )

    await waitFor(() => expect(sendMessage.mutate).toHaveBeenCalledTimes(1))
    expect(sendMessage.mutate.mock.calls[0]?.[0]).toMatchObject({
      sessionId: SESSION,
      message: 'Answer to your question "Which color?": Teal',
    })
  })

  it('answers a live parked run in its turn, with no new message', async () => {
    useChatStore.getState().setParkedClaudeDialog(SESSION, {
      toolUseId: QUESTION_ID,
      kind: 'question',
    })
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'answer_claude_dialog' ? true : undefined)
    )
    const { handlers, sendMessage } = setup()

    handlers.handleQuestionAnswer(
      QUESTION_ID,
      [{ questionIndex: 0, selectedOptions: [1] }],
      questions
    )

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'answer_claude_dialog',
        expect.objectContaining({ toolUseId: QUESTION_ID })
      )
    )
    expect(sendMessage.mutate).not.toHaveBeenCalled()
  })

  it('resumes a paused plan in build mode when the user approves it', async () => {
    invokeMock.mockResolvedValue(undefined)
    const { handlers, sendMessage } = setup()

    handlers.handlePlanApproval('assistant-plan')

    await waitFor(() => expect(sendMessage.mutate).toHaveBeenCalledTimes(1))
    expect(sendMessage.mutate.mock.calls[0]?.[0]).toMatchObject({
      sessionId: SESSION,
      executionMode: 'build',
      message: expect.stringContaining('Plan approved.'),
    })
  })
})
