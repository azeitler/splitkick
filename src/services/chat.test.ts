import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  hasBackend: () => true,
}))

import { prefetchSessions } from './chat'
import { useChatStore } from '@/store/chat-store'

describe('prefetchSessions', () => {
  beforeEach(() => {
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
