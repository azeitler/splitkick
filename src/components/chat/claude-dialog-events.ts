import type { ToolCall } from '@/types/chat'
import { hasQuestionAnswerOutput, isAskUserQuestion } from '@/types/chat'

/**
 * A Claude `ExitPlanMode` that was approved in its own turn, so its plan no
 * longer waits for approval. Only sessions from 1.6.0 and 1.6.1 hold such
 * turns (#136); since then a plan ends the turn and has no result. Only the
 * CLI's approval text counts: a 1.6.x plan whose call timed out or was paused
 * has a deny text as its result and still waits. The text is Claude's own, so
 * other backends that map their plan tools to `ExitPlanMode` never match.
 */
export function isPlanAnsweredInTurn(toolCall: ToolCall): boolean {
  return (
    toolCall.name === 'ExitPlanMode' &&
    !!toolCall.output?.trim().startsWith('User has approved')
  )
}

/**
 * The live run waits for the user: a streamed question (OpenCode, Codex) has
 * no answer yet. Nothing runs then, so the chat shows no running timer or
 * spinner. A Claude question ends its turn, so it never waits in a live run.
 */
export function isRunAwaitingAnswer(state: {
  toolCalls: readonly ToolCall[]
  isAnswered: (toolCallId: string) => boolean
}): boolean {
  return state.toolCalls.some(
    tc =>
      isAskUserQuestion(tc) &&
      !hasQuestionAnswerOutput(tc.output) &&
      !state.isAnswered(tc.id)
  )
}
