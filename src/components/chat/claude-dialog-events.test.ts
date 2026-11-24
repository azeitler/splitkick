import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import type { ToolCall } from '@/types/chat'
import {
  applyClaudeDialogResolved,
  applyClaudeDialogWaiting,
  getParkedClaudeDialog,
  hydrateParkedClaudeDialog,
  isDialogPaused,
  isRunAwaitingAnswer,
  isPlanAnsweredInTurn,
  skipParkedClaudeDialog,
} from './claude-dialog-events'

const SESSION = 'session-dialog'

afterEach(() => {
  const store = useChatStore.getState()
  store.setParkedClaudeDialog(SESSION, null)
  store.setWaitingForInput(SESSION, false)
})

describe('claude dialog events (#136)', () => {
  it('a parked question makes the live session wait, once per dialog', () => {
    const payload = {
      sessionId: SESSION,
      toolUseId: 'toolu_q',
      kind: 'question',
    }
    expect(applyClaudeDialogWaiting(payload)).toBe(true)
    expect(getParkedClaudeDialog(SESSION)).toEqual({
      toolUseId: 'toolu_q',
      kind: 'question',
    })
    expect(useChatStore.getState().isWaitingForInput(SESSION)).toBe(true)
    // A repeated event for the same call does not notify again.
    expect(applyClaudeDialogWaiting(payload)).toBe(false)
  })

  it('resolving clears only the dialog that is parked', () => {
    applyClaudeDialogWaiting({
      sessionId: SESSION,
      toolUseId: 'toolu_plan',
      kind: 'plan',
    })
    applyClaudeDialogResolved({ sessionId: SESSION, toolUseId: 'toolu_old' })
    expect(getParkedClaudeDialog(SESSION)?.kind).toBe('plan')

    applyClaudeDialogResolved({ sessionId: SESSION, toolUseId: 'toolu_plan' })
    expect(getParkedClaudeDialog(SESSION)).toBeUndefined()
    expect(useChatStore.getState().isWaitingForInput(SESSION)).toBe(false)
  })

  it('a new message skips the parked question and tells the backend', () => {
    applyClaudeDialogWaiting({
      sessionId: SESSION,
      toolUseId: 'toolu_skip',
      kind: 'question',
    })
    const invokeSkip = vi.fn(() => Promise.resolve(true))

    expect(skipParkedClaudeDialog(SESSION, invokeSkip)).toBe(true)
    expect(invokeSkip).toHaveBeenCalledWith(SESSION)
    // The card shows "Skipped": answered with no answers.
    const store = useChatStore.getState()
    expect(store.isQuestionAnswered(SESSION, 'toolu_skip')).toBe(true)
    expect(store.getSubmittedAnswers(SESSION, 'toolu_skip')).toEqual([])
  })

  it('nothing to skip without a parked dialog', () => {
    const invokeSkip = vi.fn(() => Promise.resolve(true))
    expect(skipParkedClaudeDialog(SESSION, invokeSkip)).toBe(false)
    expect(invokeSkip).not.toHaveBeenCalled()
  })

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
    // Cut off by the legacy kill: still waits for approval.
    expect(isPlanAnsweredInTurn(plan(), 'claude')).toBe(false)
    // Other backends map their own plan tools to ExitPlanMode.
    expect(isPlanAnsweredInTurn(plan('done'), 'opencode')).toBe(false)
  })

  it('a reloaded client restores the parked plan from the backend', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'toolu_q', name: 'AskUserQuestion', input: {}, output: 'answered' },
      { id: 'toolu_plan', name: 'ExitPlanMode', input: {} },
    ]
    const isPending = vi.fn((id: string) =>
      Promise.resolve(id === 'toolu_plan')
    )

    await expect(
      hydrateParkedClaudeDialog(SESSION, toolCalls, isPending)
    ).resolves.toEqual({ toolUseId: 'toolu_plan', kind: 'plan' })
    expect(isPending).toHaveBeenCalledWith('toolu_plan')
    expect(useChatStore.getState().isWaitingForInput(SESSION)).toBe(true)
  })

  it('does not restore a dialog the backend no longer holds', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'toolu_gone', name: 'AskUserQuestion', input: {} },
    ]
    await expect(
      hydrateParkedClaudeDialog(SESSION, toolCalls, () =>
        Promise.resolve(false)
      )
    ).resolves.toBeUndefined()
    expect(getParkedClaudeDialog(SESSION)).toBeUndefined()
  })
})

describe('a dialog with no run behind it is paused (#155)', () => {
  it('is paused when nothing sends and no live run is parked on it', () => {
    expect(
      isDialogPaused({ sending: false, parkedToolUseId: null, toolUseId: 'q' })
    ).toBe(true)
  })

  it('is live while a run is parked on it or the session sends', () => {
    expect(
      isDialogPaused({ sending: false, parkedToolUseId: 'q', toolUseId: 'q' })
    ).toBe(false)
    expect(
      isDialogPaused({ sending: true, parkedToolUseId: null, toolUseId: 'q' })
    ).toBe(false)
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

  it('waits while a Claude dialog is parked', () => {
    expect(
      isRunAwaitingAnswer({
        parked: true,
        toolCalls: [],
        isAnswered: () => false,
      })
    ).toBe(true)
  })

  it('waits while a streamed question has no answer', () => {
    expect(
      isRunAwaitingAnswer({
        parked: false,
        toolCalls: [question],
        isAnswered: () => false,
      })
    ).toBe(true)
  })

  it('runs again once the question is answered', () => {
    expect(
      isRunAwaitingAnswer({
        parked: false,
        toolCalls: [question],
        isAnswered: () => true,
      })
    ).toBe(false)
    expect(
      isRunAwaitingAnswer({
        parked: false,
        toolCalls: [{ ...question, output: 'The user answered: Teal' }],
        isAnswered: () => false,
      })
    ).toBe(false)
  })
})
