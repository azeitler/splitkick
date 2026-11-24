import { describe, expect, it } from 'vitest'
import type { ToolCall } from '@/types/chat'
import {
  isRunAwaitingAnswer,
  isPlanAnsweredInTurn,
} from './claude-dialog-events'

describe('Claude plans approved in their own turn (sessions from 1.6.0 and 1.6.1)', () => {
  const plan = (output?: string): ToolCall => ({
    id: 'toolu_plan',
    name: 'ExitPlanMode',
    input: {},
    output,
  })

  it('a plan with the CLI approval text was approved in its own turn', () => {
    expect(
      isPlanAnsweredInTurn(
        plan('User has approved your plan. You can now start coding.')
      )
    ).toBe(true)
  })

  it('a plan without a result still waits: the turn ended at the plan', () => {
    expect(isPlanAnsweredInTurn(plan())).toBe(false)
    expect(isPlanAnsweredInTurn(plan('  '))).toBe(false)
  })

  it('a 1.6.x plan call that timed out or paused still waits', () => {
    for (const denied of [
      'Timed out waiting for the user to respond.',
      'Splitkick paused this run until the user answers.',
      'Splitkick closed this request before it was answered.',
    ]) {
      expect(isPlanAnsweredInTurn(plan(denied))).toBe(false)
    }
  })

  it('other backends that map their plan tools to ExitPlanMode keep waiting', () => {
    expect(isPlanAnsweredInTurn(plan('done'))).toBe(false)
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
