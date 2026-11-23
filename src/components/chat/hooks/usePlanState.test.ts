import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlanState } from './usePlanState'
import type { ChatMessage, ContentBlock, ToolCall } from '@/types/chat'

describe('usePlanState', () => {
  it('prefers streaming assistant plan text over explanation-only tool fallback', () => {
    const currentToolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Repo inspected. Native plan had no prose body.',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    const currentStreamingContentBlocks: ContentBlock[] = [
      { type: 'tool_use', tool_call_id: 'plan-1' },
      {
        type: 'text',
        text: 'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
      },
    ]

    const { result } = renderHook(() =>
      usePlanState({
        sessionMessages: [] as ChatMessage[],
        currentToolCalls,
        currentStreamingContent:
          'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
        currentStreamingContentBlocks,
        isSending: true,
      })
    )

    expect(result.current.hasPendingPlanApproval).toBe(false)
    expect(result.current.latestPlanContent).toBe(
      'Plan:\n- Implement changes\n- Add tests'
    )
  })

  it('a Claude plan approved in its own turn no longer waits (#136)', () => {
    const planMessage = (output?: string): ChatMessage =>
      ({
        id: 'msg-plan',
        session_id: 's1',
        role: 'assistant',
        content: '',
        timestamp: 0,
        tool_calls: [
          { id: 'toolu_plan', name: 'ExitPlanMode', input: {}, output },
        ],
      }) as ChatMessage
    const run = (messages: ChatMessage[], backend: 'claude' | 'opencode') =>
      renderHook(() =>
        usePlanState({
          sessionMessages: messages,
          currentToolCalls: [],
          currentStreamingContent: '',
          currentStreamingContentBlocks: [],
          isSending: false,
          sessionBackend: backend,
        })
      ).result.current

    expect(
      run([planMessage('User has approved your plan.')], 'claude')
        .hasPendingPlanApproval
    ).toBe(false)
    // Cut off by the legacy kill, or another backend: still waits.
    expect(run([planMessage()], 'claude').hasPendingPlanApproval).toBe(true)
    expect(run([planMessage('done')], 'opencode').hasPendingPlanApproval).toBe(
      true
    )
  })
})
