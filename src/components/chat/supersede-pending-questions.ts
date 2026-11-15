import type { ChatMessage } from '@/types/chat'
import { isAskUserQuestion } from '@/types/chat'
import { useChatStore } from '@/store/chat-store'

/**
 * A new turn supersedes the questions the previous turn left open.
 *
 * The question cards otherwise count as answered only once a user message
 * follows them in the loaded history. A turn started outside this client
 * (Splitkick MCP `send_chat_message`, another client, the queue) may not put
 * that message into the list until the run ends, so the old card stayed live
 * and clickable for the whole new turn.
 *
 * Marks each open `AskUserQuestion` of the last assistant message as answered
 * with no answers, which the card shows as "Skipped". A real answer the user
 * just submitted is kept: `markQuestionAnswered` ignores ids it already has.
 * Per tool id, not `setQuestionsSkipped`: that flag covers every card in the
 * session, so the next question would show as skipped too.
 */
export function supersedePendingQuestions(
  sessionId: string,
  messages: readonly ChatMessage[] | undefined
): void {
  if (!messages) return
  let lastAssistant: ChatMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') {
      lastAssistant = messages[i]
      break
    }
  }
  if (!lastAssistant?.tool_calls?.length) return

  const { isQuestionAnswered, markQuestionAnswered } = useChatStore.getState()
  for (const toolCall of lastAssistant.tool_calls) {
    if (
      isAskUserQuestion(toolCall) &&
      !isQuestionAnswered(sessionId, toolCall.id)
    ) {
      markQuestionAnswered(sessionId, toolCall.id, [])
    }
  }
}
