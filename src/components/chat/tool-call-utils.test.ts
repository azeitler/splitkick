import { describe, expect, it } from 'vitest'
import {
  isDuplicatePlanTextBlock,
  resolvePlanContent,
} from './tool-call-utils'
import type { ToolCall } from '@/types/chat'

describe('resolvePlanContent', () => {
  it('extracts only the plan section from assistant text when tool only has explanation', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Repo inspected. Native plan had no prose body.',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent:
          'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
      })
    ).toEqual({
      content: 'Plan:\n- Implement changes\n- Add tests',
      source: 'message_text',
    })
  })

  it('keeps tool-provided plan content ahead of assistant text', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          plan: 'Plan:\n- Tool plan wins',
          explanation: 'Fallback explanation',
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent: 'Plan:\n- Message text loses',
      })
    ).toEqual({
      content: 'Plan:\n- Tool plan wins',
      source: 'plan',
    })
  })

  it('ignores non-string tool plan payloads and falls back to assistant text', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          plan: [{ step: 'Wrong runtime shape' }],
          explanation: 'Summary only',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent:
          'Repo inspected.\n\nPlan:\n- Remove auto-continue\n- Add tests',
      })
    ).toEqual({
      content: 'Plan:\n- Remove auto-continue\n- Add tests',
      source: 'message_text',
    })
  })

  it('extracts a plan section from fragmented text blocks before explanation fallback', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Summary only',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        contentBlocks: [
          { type: 'text', text: 'Repo inspected.\n\n' },
          { type: 'text', text: 'Plan:\n- Remove auto-continue' },
          { type: 'text', text: '\n- Add tests' },
        ],
      })
    ).toEqual({
      content: 'Plan:\n- Remove auto-continue\n- Add tests',
      source: 'message_text',
    })
  })
})

describe('isDuplicatePlanTextBlock', () => {
  it('matches blocks whose extracted plan equals resolved plan content', () => {
    expect(
      isDuplicatePlanTextBlock(
        'Repo inspected.\n\nPlan:\n- Implement changes',
        'Plan:\n- Implement changes'
      )
    ).toBe(true)
  })

  it('does not hide different assistant text just because it contains a plan heading', () => {
    expect(
      isDuplicatePlanTextBlock(
        'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
        'Plan:\n- Implement changes'
      )
    ).toBe(false)
  })
})
