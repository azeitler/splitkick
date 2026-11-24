import type { Backend, ToolCall } from '@/types/chat'
import { hasQuestionAnswerOutput, isAskUserQuestion } from '@/types/chat'

/**
 * A Claude `ExitPlanMode` with a tool result was approved or declined in its
 * own turn, so its plan no longer waits for approval. Only sessions from
 * 1.6.0 and 1.6.1 hold such turns (#136); since then a plan ends the turn and
 * has no result. Claude only: other backends map their own plan tools to
 * `ExitPlanMode` and keep their rules.
 */
export function isPlanAnsweredInTurn(
  toolCall: ToolCall,
  backend: Backend | null | undefined
): boolean {
  return (
    backend === 'claude' &&
    toolCall.name === 'ExitPlanMode' &&
    !!toolCall.output?.trim()
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
