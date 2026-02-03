import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { usePreferences } from '@/services/preferences'
import { useSendMessage, markPlanApproved, chatQueryKeys } from '@/services/chat'
import type { Session } from '@/types/chat'
import type { SessionCardData } from '../session-card-utils'

interface UsePlanApprovalParams {
  worktreeId: string
  worktreePath: string
}

/**
 * Provides plan approval handlers for canvas session cards.
 */
export function usePlanApproval({ worktreeId, worktreePath }: UsePlanApprovalParams) {
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
    (card: SessionCardData) => {
      if (!card.pendingPlanMessageId) return

      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId

      markPlanApproved(worktreeId, worktreePath, sessionId, messageId)

      queryClient.setQueryData<Session>(
        chatQueryKeys.session(sessionId),
        old => {
          if (!old) return old
          return {
            ...old,
            messages: old.messages.map(msg =>
              msg.id === messageId ? { ...msg, plan_approved: true } : msg
            ),
          }
        }
      )

      setExecutionMode(sessionId, 'build')
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)
      setPendingPlanMessageId(sessionId, null)

      const model = preferences?.selected_model ?? 'opus'
      const thinkingLevel = preferences?.thinking_level ?? 'off'

      setLastSentMessage(sessionId, 'Approved')
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, model)
      setExecutingMode(sessionId, 'build')

      sendMessage.mutate({
        sessionId,
        worktreeId,
        worktreePath,
        message: 'Approved',
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
    (card: SessionCardData) => {
      if (!card.pendingPlanMessageId) return

      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId

      markPlanApproved(worktreeId, worktreePath, sessionId, messageId)

      queryClient.setQueryData<Session>(
        chatQueryKeys.session(sessionId),
        old => {
          if (!old) return old
          return {
            ...old,
            messages: old.messages.map(msg =>
              msg.id === messageId ? { ...msg, plan_approved: true } : msg
            ),
          }
        }
      )

      setExecutionMode(sessionId, 'yolo')
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)
      setPendingPlanMessageId(sessionId, null)

      const model = preferences?.selected_model ?? 'opus'
      const thinkingLevel = preferences?.thinking_level ?? 'off'

      setLastSentMessage(sessionId, 'Approved - yolo')
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, model)
      setExecutingMode(sessionId, 'yolo')

      sendMessage.mutate({
        sessionId,
        worktreeId,
        worktreePath,
        message: 'Approved - yolo',
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
