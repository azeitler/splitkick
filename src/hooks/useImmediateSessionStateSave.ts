import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type { LabelData } from '@/types/chat'

/**
 * Saves reviewing/waiting state immediately when it changes.
 * These states change infrequently, so no debounce needed.
 * Fixes the issue where debounced saves don't complete before app close.
 */
export function useImmediateSessionStateSave() {
  // Track previous values to detect changes
  const prevReviewingRef = useRef<Record<string, boolean>>({})
  const prevWaitingRef = useRef<Record<string, boolean>>({})
  const prevLabelsRef = useRef<Record<string, LabelData>>({})

  useEffect(() => {
    // Initialize with current state
    const initialState = useChatStore.getState()
    prevReviewingRef.current = { ...initialState.reviewingSessions }
    prevWaitingRef.current = { ...initialState.waitingForInputSessionIds }
    prevLabelsRef.current = { ...initialState.sessionLabels }

    const unsubscribe = useChatStore.subscribe(state => {
      const {
        reviewingSessions,
        waitingForInputSessionIds,
        sessionLabels,
        sessionWorktreeMap,
        worktreePaths,
      } = state

      // Check for reviewing changes
      for (const [sessionId, isReviewing] of Object.entries(
        reviewingSessions
      )) {
        if (prevReviewingRef.current[sessionId] !== isReviewing) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            isReviewing,
          })
        }
      }
      // Check for removed entries (session marked as not reviewing)
      for (const sessionId of Object.keys(prevReviewingRef.current)) {
        if (!(sessionId in reviewingSessions)) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            isReviewing: false,
          })
        }
      }

      // Check for waiting changes
      for (const [sessionId, isWaiting] of Object.entries(
        waitingForInputSessionIds
      )) {
        if (prevWaitingRef.current[sessionId] !== isWaiting) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            waitingForInput: isWaiting,
          })
        }
      }
      // Check for removed entries (session no longer waiting)
      for (const sessionId of Object.keys(prevWaitingRef.current)) {
        if (!(sessionId in waitingForInputSessionIds)) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            waitingForInput: false,
          })
        }
      }

      // Check for label changes
      for (const [sessionId, label] of Object.entries(sessionLabels)) {
        if (JSON.stringify(prevLabelsRef.current[sessionId]) !== JSON.stringify(label)) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            label,
          })
        }
      }
      // Check for removed labels
      for (const sessionId of Object.keys(prevLabelsRef.current)) {
        if (!(sessionId in sessionLabels)) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            label: null,
          })
        }
      }

      prevReviewingRef.current = { ...reviewingSessions }
      prevWaitingRef.current = { ...waitingForInputSessionIds }
      prevLabelsRef.current = { ...sessionLabels }
    })

    return unsubscribe
  }, [])
}

async function saveSessionStatus(
  sessionId: string,
  sessionWorktreeMap: Record<string, string>,
  worktreePaths: Record<string, string>,
  updates: {
    isReviewing?: boolean
    waitingForInput?: boolean
    label?: LabelData | null
  }
) {
  const worktreeId = sessionWorktreeMap[sessionId]
  const worktreePath = worktreeId ? worktreePaths[worktreeId] : null

  if (!worktreeId || !worktreePath) {
    logger.warn('Cannot save session status: missing worktree info', {
      sessionId,
    })
    return
  }

  try {
    // Send explicit null to remove, or the label object to set
    // Use undefined for label when we want to set/clear to avoid Tauri treating null as missing
    const labelValue = updates.label ?? undefined
    const clearLabel = 'label' in updates && updates.label === null
    await invoke('update_session_state', {
      worktreeId,
      worktreePath,
      sessionId,
      isReviewing: updates.isReviewing,
      waitingForInput: updates.waitingForInput,
      label: labelValue,
      clearLabel,
    })
  } catch (error) {
    logger.error('Failed to save session status', { sessionId, error })
  }
}
