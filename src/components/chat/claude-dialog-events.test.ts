import { describe, expect, it } from 'vitest'
import type { ToolCall } from '@/types/chat'
import {
  isRunAwaitingAnswer,
  isPlanAnsweredInTurn,
} from './claude-dialog-events'

describe('Claude plans answered in their own turn (sessions from 1.6.0 and 1.6.1)', () => {
  it('a Claude plan with a tool result was answered in its own turn', () => {
    const plan = (output?: string): ToolCall => ({
      id: 'toolu_plan',
      name: 'ExitPlanMode',
      input: {},
      output,
    })
    expect(
      isPlanAnsweredInTurn(plan('User has approved your plan.'), 'claude')
    ).toBe(true)
    // The turn ended at the plan: it still waits for approval.
    expect(isPlanAnsweredInTurn(plan(), 'claude')).toBe(false)
    // Other backends map their own plan tools to ExitPlanMode.
    expect(isPlanAnsweredInTurn(plan('done'), 'opencode')).toBe(false)
  })
})

describe('a live run that waits for an answer shows no running timer', () => {
  const question = {
    id: 'q-1',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          header: 'Color',
          question: 'Which color?',
          multiSelect: false,
          options: [{ label: 'Teal' }],
        },
      ],
    },
  } satisfies ToolCall

  it('runs while no question is streamed', () => {
    expect(
      isRunAwaitingAnswer({ toolCalls: [], isAnswered: () => false })
    ).toBe(false)
  })

  it('waits while a streamed question has no answer', () => {
    expect(
      isRunAwaitingAnswer({ toolCalls: [question], isAnswered: () => false })
    ).toBe(true)
  })

  it('runs again once the question is answered', () => {
    expect(
      isRunAwaitingAnswer({ toolCalls: [question], isAnswered: () => true })
    ).toBe(false)
    expect(
      isRunAwaitingAnswer({
        toolCalls: [{ ...question, output: 'The user answered: Teal' }],
        isAnswered: () => false,
      })
    ).toBe(false)
  })
})
