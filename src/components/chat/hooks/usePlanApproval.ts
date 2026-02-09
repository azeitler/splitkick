import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { usePreferences } from '@/services/preferences'
import {
  useSendMessage,
  markPlanApproved,
  chatQueryKeys,
} from '@/services/chat'
import type { Session } from '@/types/chat'
import type { SessionCardData } from '../session-card-utils'

interface UsePlanApprovalParams {
  worktreeId: string
  worktreePath: string
}

/**
 * Formats the approval message, including updated plan if content was changed.
 */
function formatApprovalMessage(
  baseMessage: string,
  updatedPlan?: string,
  originalPlan?: string | null
): string {
  // No updated plan provided, or plan unchanged
  if (!updatedPlan || updatedPlan === originalPlan) {
    return baseMessage
  }

  return `I've updated the plan. Please review and execute:

<updated-plan>
${updatedPlan}
</updated-plan>`
}

/**
 * Provides plan approval handlers for canvas session cards.
 */
export function usePlanApproval({
  worktreeId,
  worktreePath,
}: UsePlanApprovalParams) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const sendMessage = useSendMessage()

  const {
    setExecutionMode,
    addSendingSession,
    setSelectedModel,
    setLastSentMessage,
    setError,
    setExecutingMode,
    setSessionReviewing,
    setWaitingForInput,
    clearToolCalls,
    clearStreamingContentBlocks,
    setPendingPlanMessageId,
  } = useChatStore.getState()

  const handlePlanApproval = useCallback(
    (card: SessionCardData, updatedPlan?: string) => {
      console.log('[usePlanApproval] handlePlanApproval called')
      console.log(
        '[usePlanApproval] card.pendingPlanMessageId:',
        card.pendingPlanMessageId
      )
      console.log('[usePlanApproval] updatedPlan length:', updatedPlan?.length)

      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId
      const originalPlan = card.planContent

      // If there's a pending plan message, mark it as approved
      if (messageId) {
        markPlanApproved(worktreeId, worktreePath, sessionId, messageId)

        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old => {
            if (!old) return old
            return {
              ...old,
              approved_plan_message_ids: [
                ...(old.approved_plan_message_ids ?? []),
                messageId,
              ],
              messages: old.messages.map(msg =>
                msg.id === messageId ? { ...msg, plan_approved: true } : msg
              ),
            }
          }
        )

        // Invalidate sessions list so canvas cards update
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })
      }

      setExecutionMode(sessionId, 'build')
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)
      setPendingPlanMessageId(sessionId, null)

      const model = preferences?.selected_model ?? 'opus'
      const thinkingLevel = preferences?.thinking_level ?? 'off'

      // Format message - if no pending plan, always include the updated plan content
      const message = messageId
        ? formatApprovalMessage('Approved', updatedPlan, originalPlan)
        : `I've updated the plan. Please review and execute:\n\n<updated-plan>\n${updatedPlan}\n</updated-plan>`

      console.log(
        '[usePlanApproval] sending message:',
        message.substring(0, 100)
      )

      setLastSentMessage(sessionId, message)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, model)
      setExecutingMode(sessionId, 'build')

      sendMessage.mutate({
        sessionId,
        worktreeId,
        worktreePath,
        message,
        model,
        executionMode: 'build',
        thinkingLevel,
        disableThinkingForMode: true,
      })
    },
    [
      worktreeId,
      worktreePath,
      queryClient,
      preferences,
      sendMessage,
      setExecutionMode,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
      setWaitingForInput,
      setPendingPlanMessageId,
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  const handlePlanApprovalYolo = useCallback(
    (card: SessionCardData, updatedPlan?: string) => {
      console.log('[usePlanApproval] handlePlanApprovalYolo called')
      console.log(
        '[usePlanApproval] card.pendingPlanMessageId:',
        card.pendingPlanMessageId
      )
      console.log('[usePlanApproval] updatedPlan length:', updatedPlan?.length)

      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId
      const originalPlan = card.planContent

      // If there's a pending plan message, mark it as approved
      if (messageId) {
        markPlanApproved(worktreeId, worktreePath, sessionId, messageId)

        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old => {
            if (!old) return old
            return {
              ...old,
              approved_plan_message_ids: [
                ...(old.approved_plan_message_ids ?? []),
                messageId,
              ],
              messages: old.messages.map(msg =>
                msg.id === messageId ? { ...msg, plan_approved: true } : msg
              ),
            }
          }
        )

        // Invalidate sessions list so canvas cards update
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })
      }

      setExecutionMode(sessionId, 'yolo')
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)
      setPendingPlanMessageId(sessionId, null)

      const model = preferences?.selected_model ?? 'opus'
      const thinkingLevel = preferences?.thinking_level ?? 'off'

      // Format message - if no pending plan, always include the updated plan content
      const message = messageId
        ? formatApprovalMessage('Approved - yolo', updatedPlan, originalPlan)
        : `I've updated the plan. Please review and execute:\n\n<updated-plan>\n${updatedPlan}\n</updated-plan>`

      console.log(
        '[usePlanApproval] sending message:',
        message.substring(0, 100)
      )

      setLastSentMessage(sessionId, message)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, model)
      setExecutingMode(sessionId, 'yolo')

      sendMessage.mutate({
        sessionId,
        worktreeId,
        worktreePath,
        message,
        model,
        executionMode: 'yolo',
        thinkingLevel,
        disableThinkingForMode: true,
      })
    },
    [
      worktreeId,
      worktreePath,
      queryClient,
      preferences,
      sendMessage,
      setExecutionMode,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
      setWaitingForInput,
      setPendingPlanMessageId,
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  return { handlePlanApproval, handlePlanApprovalYolo }
}
