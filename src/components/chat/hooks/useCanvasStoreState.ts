import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '@/store/chat-store'
import type { ChatStoreState } from '../session-card-utils'

/**
 * Subscribe to chat store state needed for computing session card data.
 * Uses useShallow for shallow equality — prevents re-renders when
 * unrelated store slices change but these references stay the same.
 */
export function useCanvasStoreState(): ChatStoreState {
  return useChatStore(
    useShallow(state => ({
      sendingSessionIds: state.sendingSessionIds,
      executingModes: state.executingModes,
      executionModes: state.executionModes,
      activeToolCalls: state.activeToolCalls,
      answeredQuestions: state.answeredQuestions,
      waitingForInputSessionIds: state.waitingForInputSessionIds,
      reviewingSessions: state.reviewingSessions,
      pendingPermissionDenials: state.pendingPermissionDenials,
      sessionDigests: state.sessionDigests,
      sessionLabels: state.sessionLabels,
    }))
  )
}
