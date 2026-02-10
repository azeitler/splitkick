import { useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import type { ChatStoreState } from '../session-card-utils'

/**
 * Subscribe to chat store state needed for computing session card data.
 * Extracts status-related state into a memoized object.
 */
export function useCanvasStoreState(): ChatStoreState {
  const sendingSessionIds = useChatStore(state => state.sendingSessionIds)
  const executingModes = useChatStore(state => state.executingModes)
  const executionModes = useChatStore(state => state.executionModes)
  const activeToolCalls = useChatStore(state => state.activeToolCalls)
  const answeredQuestions = useChatStore(state => state.answeredQuestions)
  const waitingForInputSessionIds = useChatStore(
    state => state.waitingForInputSessionIds
  )
  const reviewingSessions = useChatStore(state => state.reviewingSessions)
  const pendingPermissionDenials = useChatStore(
    state => state.pendingPermissionDenials
  )
  const sessionDigests = useChatStore(state => state.sessionDigests)

  return useMemo(
    () => ({
      sendingSessionIds,
      executingModes,
      executionModes,
      activeToolCalls,
      answeredQuestions,
      waitingForInputSessionIds,
      reviewingSessions,
      pendingPermissionDenials,
      sessionDigests,
    }),
    [
      sendingSessionIds,
      executingModes,
      executionModes,
      activeToolCalls,
      answeredQuestions,
      waitingForInputSessionIds,
      reviewingSessions,
      pendingPermissionDenials,
      sessionDigests,
    ]
  )
}
