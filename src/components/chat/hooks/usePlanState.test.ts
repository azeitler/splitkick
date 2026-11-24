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
    const run = (messages: ChatMessage[]) =>
      renderHook(() =>
        usePlanState({
          sessionMessages: messages,
          currentToolCalls: [],
          currentStreamingContent: '',
          currentStreamingContentBlocks: [],
          isSending: false,
        })
      ).result.current

    expect(
      run([planMessage('User has approved your plan.')]).hasPendingPlanApproval
    ).toBe(false)
    // The turn ended at the plan, or another backend's output: still waits.
    expect(run([planMessage()]).hasPendingPlanApproval).toBe(true)
    expect(run([planMessage('done')]).hasPendingPlanApproval).toBe(true)
    // A 1.6.x plan call that timed out or paused: never approved, still waits.
    expect(
      run([planMessage('Timed out waiting for the user to respond.')])
        .hasPendingPlanApproval
    ).toBe(true)
  })
})
