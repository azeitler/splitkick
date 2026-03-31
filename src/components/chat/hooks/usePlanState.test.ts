import { describe, expect, it, vi } from 'vitest'
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
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
      })
    )

    expect(result.current.hasStreamingPlan).toBe(true)
    expect(result.current.latestPlanContent).toBe(
      'Plan:\n- Implement changes\n- Add tests'
    )
  })
})
