import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useUpdateSessionState } from '@/services/chat'
import { useSessions } from '@/services/chat'
import { logger } from '@/lib/logger'
import type { QuestionAnswer, PermissionDenial } from '@/types/chat'

// Simple debounce implementation with flush support
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void; flush: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pendingArgs: any[] | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debounced = ((...args: any[]) => {
    pendingArgs = args
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
      pendingArgs = null
    }, delay)
  }) as T & { cancel: () => void; flush: () => void }

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
      pendingArgs = null
    }
  }

  debounced.flush = () => {
    if (timeoutId && pendingArgs) {
      clearTimeout(timeoutId)
      fn(...pendingArgs)
      timeoutId = null
      pendingArgs = null
    }
  }

  return debounced
}

interface SessionState {
  answeredQuestions: string[]
  submittedAnswers: Record<string, QuestionAnswer[]>
  fixedFindings: string[]
  pendingPermissionDenials: PermissionDenial[]
  deniedMessageContext: {
    message: string
    model: string
    thinking_level: string
  } | null
  isReviewing: boolean
  waitingForInput: boolean
  planFilePath: string | null
  pendingPlanMessageId: string | null
}

/**
 * Hook that handles session-specific state persistence:
 * 1. Loads session state from the Session object when session changes
 * 2. Subscribes to Zustand changes and debounce saves to session file
 *
 * This hook should be used at the app level (e.g., in App.tsx)
 */
export function useSessionStatePersistence() {
  const activeWorktreeId = useChatStore(state => state.activeWorktreeId)
  const activeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const activeSessionIds = useChatStore(state => state.activeSessionIds)

  // Get active session ID for current worktree
  const activeSessionId = activeWorktreeId
    ? (activeSessionIds[activeWorktreeId] ?? null)
    : null

  // Load sessions to get session data
  const { data: sessionsData } = useSessions(
    activeWorktreeId,
    activeWorktreePath
  )

  const { mutate: updateSessionState } = useUpdateSessionState()

  // Track if we're loading from session (to avoid save loop)
  const isLoadingRef = useRef(false)
  // Track last saved state to detect actual changes
  const lastSavedStateRef = useRef<SessionState | null>(null)

  // Create debounced save function
  const debouncedSaveRef = useRef<ReturnType<
    typeof debounce<(state: SessionState) => void>
  > | null>(null)

  // Get current session state from Zustand
  const getCurrentSessionState = useCallback(
    (sessionId: string): SessionState => {
      const {
        answeredQuestions,
        submittedAnswers,
        fixedFindings,
        pendingPermissionDenials,
        deniedMessageContext,
        reviewingSessions,
        waitingForInputSessionIds,
        planFilePaths,
        pendingPlanMessageIds,
      } = useChatStore.getState()

      const ctx = deniedMessageContext[sessionId]

      return {
        answeredQuestions: Array.from(
          answeredQuestions[sessionId] ?? new Set()
        ),
        submittedAnswers: submittedAnswers[sessionId] ?? {},
        fixedFindings: Array.from(fixedFindings[sessionId] ?? new Set()),
        pendingPermissionDenials: pendingPermissionDenials[sessionId] ?? [],
        deniedMessageContext: ctx
          ? {
              message: ctx.message,
              model: ctx.model ?? '',
              thinking_level: ctx.thinkingLevel ?? 'off',
            }
          : null,
        isReviewing: reviewingSessions[sessionId] ?? false,
        waitingForInput: waitingForInputSessionIds[sessionId] ?? false,
        planFilePath: planFilePaths[sessionId] ?? null,
        pendingPlanMessageId: pendingPlanMessageIds[sessionId] ?? null,
      }
    },
    []
  )

  // Initialize debounced save function when worktree/session changes
  useEffect(() => {
    if (!activeWorktreeId || !activeWorktreePath || !activeSessionId) {
      return
    }

    const worktreeId = activeWorktreeId
    const worktreePath = activeWorktreePath
    const sessionId = activeSessionId

    debouncedSaveRef.current = debounce((state: SessionState) => {
      if (isLoadingRef.current) return

      logger.debug('Saving session state (debounced)', { sessionId })
      updateSessionState({
        worktreeId,
        worktreePath,
        sessionId,
        answeredQuestions: state.answeredQuestions,
        submittedAnswers: state.submittedAnswers,
        fixedFindings: state.fixedFindings,
        pendingPermissionDenials: state.pendingPermissionDenials,
        deniedMessageContext: state.deniedMessageContext,
        isReviewing: state.isReviewing,
        waitingForInput: state.waitingForInput,
        planFilePath: state.planFilePath,
        pendingPlanMessageId: state.pendingPlanMessageId,
      })
    }, 500)

    return () => {
      debouncedSaveRef.current?.cancel()
    }
  }, [
    activeWorktreeId,
    activeWorktreePath,
    activeSessionId,
    updateSessionState,
  ])

  // Flush pending saves on page unload/reload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      debouncedSaveRef.current?.flush()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  // Load session state from Session object when session changes
  useEffect(() => {
    if (!activeSessionId || !sessionsData) return

    const session = sessionsData.sessions.find(s => s.id === activeSessionId)
    if (!session) return

    isLoadingRef.current = true

    logger.debug('Loading session state from session file', {
      sessionId: activeSessionId,
    })

    const currentState = useChatStore.getState()

    // Build updated state
    const updates: Partial<typeof currentState> = {}

    // Load answered questions
    if (session.answered_questions && session.answered_questions.length > 0) {
      updates.answeredQuestions = {
        ...currentState.answeredQuestions,
        [activeSessionId]: new Set(session.answered_questions),
      }
    }

    // Load submitted answers
    if (
      session.submitted_answers &&
      Object.keys(session.submitted_answers).length > 0
    ) {
      updates.submittedAnswers = {
        ...currentState.submittedAnswers,
        [activeSessionId]: session.submitted_answers,
      }
    }

    // Load fixed findings
    if (session.fixed_findings && session.fixed_findings.length > 0) {
      updates.fixedFindings = {
        ...currentState.fixedFindings,
        [activeSessionId]: new Set(session.fixed_findings),
      }
    }

    // Load pending permission denials
    if (
      session.pending_permission_denials &&
      session.pending_permission_denials.length > 0
    ) {
      updates.pendingPermissionDenials = {
        ...currentState.pendingPermissionDenials,
        [activeSessionId]: session.pending_permission_denials,
      }
    }

    // Load denied message context
    if (session.denied_message_context) {
      updates.deniedMessageContext = {
        ...currentState.deniedMessageContext,
        [activeSessionId]: {
          message: session.denied_message_context.message,
          model: session.denied_message_context.model,
          thinkingLevel: session.denied_message_context.thinking_level as
            | 'off'
            | 'think'
            | 'megathink'
            | 'ultrathink',
        },
      }
    }

    // Load reviewing status (handle both true and false to fix asymmetry bug)
    updates.reviewingSessions = {
      ...currentState.reviewingSessions,
      [activeSessionId]: session.is_reviewing ?? false,
    }

    // Load waiting for input status
    updates.waitingForInputSessionIds = {
      ...currentState.waitingForInputSessionIds,
      [activeSessionId]: session.waiting_for_input ?? false,
    }

    // Load plan file path
    if (session.plan_file_path) {
      updates.planFilePaths = {
        ...currentState.planFilePaths,
        [activeSessionId]: session.plan_file_path,
      }
    }

    // Load pending plan message ID
    if (session.pending_plan_message_id) {
      updates.pendingPlanMessageIds = {
        ...currentState.pendingPlanMessageIds,
        [activeSessionId]: session.pending_plan_message_id,
      }
    }

    // Apply all updates at once
    if (Object.keys(updates).length > 0) {
      useChatStore.setState(updates)
    }

    // Store initial state as last saved to avoid immediate re-save
    lastSavedStateRef.current = getCurrentSessionState(activeSessionId)

    // Allow saves after a short delay
    setTimeout(() => {
      isLoadingRef.current = false
    }, 100)

    logger.debug('Session state loaded', { sessionId: activeSessionId })
  }, [activeSessionId, sessionsData, getCurrentSessionState])

  // Subscribe to Zustand changes and save to session file
  useEffect(() => {
    if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) {
      return
    }

    const sessionId = activeSessionId

    // Track previous values
    let prevAnsweredQuestions =
      useChatStore.getState().answeredQuestions[sessionId]
    let prevSubmittedAnswers =
      useChatStore.getState().submittedAnswers[sessionId]
    let prevFixedFindings = useChatStore.getState().fixedFindings[sessionId]
    let prevPendingDenials =
      useChatStore.getState().pendingPermissionDenials[sessionId]
    let prevDeniedContext =
      useChatStore.getState().deniedMessageContext[sessionId]
    let prevReviewing = useChatStore.getState().reviewingSessions[sessionId]
    let prevWaiting =
      useChatStore.getState().waitingForInputSessionIds[sessionId]
    let prevPlanFilePath = useChatStore.getState().planFilePaths[sessionId]
    let prevPendingPlanMessageId =
      useChatStore.getState().pendingPlanMessageIds[sessionId]

    const unsubscribe = useChatStore.subscribe(state => {
      if (isLoadingRef.current) return

      const currentAnswered = state.answeredQuestions[sessionId]
      const currentSubmitted = state.submittedAnswers[sessionId]
      const currentFixed = state.fixedFindings[sessionId]
      const currentDenials = state.pendingPermissionDenials[sessionId]
      const currentDeniedCtx = state.deniedMessageContext[sessionId]
      const currentReviewing = state.reviewingSessions[sessionId]
      const currentWaiting = state.waitingForInputSessionIds[sessionId]
      const currentPlanFilePath = state.planFilePaths[sessionId]
      const currentPendingPlanMessageId = state.pendingPlanMessageIds[sessionId]

      const hasChanges =
        currentAnswered !== prevAnsweredQuestions ||
        currentSubmitted !== prevSubmittedAnswers ||
        currentFixed !== prevFixedFindings ||
        currentDenials !== prevPendingDenials ||
        currentDeniedCtx !== prevDeniedContext ||
        currentReviewing !== prevReviewing ||
        currentWaiting !== prevWaiting ||
        currentPlanFilePath !== prevPlanFilePath ||
        currentPendingPlanMessageId !== prevPendingPlanMessageId

      if (hasChanges) {
        prevAnsweredQuestions = currentAnswered
        prevSubmittedAnswers = currentSubmitted
        prevFixedFindings = currentFixed
        prevPendingDenials = currentDenials
        prevDeniedContext = currentDeniedCtx
        prevReviewing = currentReviewing
        prevWaiting = currentWaiting
        prevPlanFilePath = currentPlanFilePath
        prevPendingPlanMessageId = currentPendingPlanMessageId

        const currentState = getCurrentSessionState(sessionId)
        debouncedSaveRef.current?.(currentState)
      }
    })

    return () => {
      unsubscribe()
      debouncedSaveRef.current?.cancel()
    }
  }, [
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    getCurrentSessionState,
  ])
}
