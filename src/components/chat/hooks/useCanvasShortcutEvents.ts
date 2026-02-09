import { useCallback, useEffect, useState } from 'react'
import type { SessionCardData } from '../session-card-utils'
import type { SessionDigest } from '@/types/chat'
import type { ApprovalContext } from '../PlanDialog'
import { useChatStore } from '@/store/chat-store'

interface UseCanvasShortcutEventsOptions {
  /** Currently selected card (null if none selected) */
  selectedCard: SessionCardData | null
  /** Whether shortcuts are enabled (disable when modal open) */
  enabled: boolean
  /** Worktree ID for approval context */
  worktreeId: string
  /** Worktree path for approval context */
  worktreePath: string
  /** Callback for plan approval */
  onPlanApproval: (card: SessionCardData, updatedPlan?: string) => void
  /** Callback for YOLO plan approval */
  onPlanApprovalYolo: (card: SessionCardData, updatedPlan?: string) => void
}

interface UseCanvasShortcutEventsResult {
  /** Plan dialog file path (if open) */
  planDialogPath: string | null
  /** Plan dialog content (if open, for inline plans) */
  planDialogContent: string | null
  /** Approval context for the open plan dialog */
  planApprovalContext: ApprovalContext | null
  /** The card associated with the open plan dialog */
  planDialogCard: SessionCardData | null
  /** Close plan dialog */
  closePlanDialog: () => void
  /** Recap dialog digest (if open) */
  recapDialogDigest: SessionDigest | null
  /** Close recap dialog */
  closeRecapDialog: () => void
  /** Handle plan view button click */
  handlePlanView: (card: SessionCardData) => void
  /** Handle recap view button click */
  handleRecapView: (card: SessionCardData) => void
}

/**
 * Shared hook for canvas shortcut event handling.
 * Listens for approve-plan, approve-plan-yolo, open-plan, open-recap events.
 */
export function useCanvasShortcutEvents({
  selectedCard,
  enabled,
  worktreeId,
  worktreePath,
  onPlanApproval,
  onPlanApprovalYolo,
}: UseCanvasShortcutEventsOptions): UseCanvasShortcutEventsResult {
  // Plan dialog state
  const [planDialogPath, setPlanDialogPath] = useState<string | null>(null)
  const [planDialogContent, setPlanDialogContent] = useState<string | null>(
    null
  )
  const [planApprovalContext, setPlanApprovalContext] =
    useState<ApprovalContext | null>(null)
  const [planDialogCard, setPlanDialogCard] = useState<SessionCardData | null>(
    null
  )

  // Recap dialog state
  const [recapDialogDigest, setRecapDialogDigest] =
    useState<SessionDigest | null>(null)
  const [recapDialogSessionId, setRecapDialogSessionId] = useState<
    string | null
  >(null)

  // Handle plan view
  const handlePlanView = useCallback(
    (card: SessionCardData) => {
      if (card.planFilePath) {
        setPlanDialogPath(card.planFilePath)
        setPlanDialogContent(null)
      } else if (card.planContent) {
        setPlanDialogContent(card.planContent)
        setPlanDialogPath(null)
      }

      // Set approval context for the dialog
      setPlanApprovalContext({
        worktreeId,
        worktreePath,
        sessionId: card.session.id,
        pendingPlanMessageId: card.pendingPlanMessageId,
      })
      setPlanDialogCard(card)
    },
    [worktreeId, worktreePath]
  )

  // Handle recap view
  const handleRecapView = useCallback((card: SessionCardData) => {
    if (card.recapDigest) {
      setRecapDialogDigest(card.recapDigest)
      setRecapDialogSessionId(card.session.id)
    }
  }, [])

  // Close handlers
  const closePlanDialog = useCallback(() => {
    setPlanDialogPath(null)
    setPlanDialogContent(null)
    setPlanApprovalContext(null)
    setPlanDialogCard(null)
  }, [])

  const closeRecapDialog = useCallback(() => {
    setRecapDialogDigest(null)
    setRecapDialogSessionId(null)
  }, [])

  // Close recap dialog when the associated session starts sending
  useEffect(() => {
    if (!recapDialogSessionId) return

    let wasSending =
      useChatStore.getState().sendingSessionIds[recapDialogSessionId] ?? false
    const unsubscribe = useChatStore.subscribe(state => {
      const isSending = state.sendingSessionIds[recapDialogSessionId] ?? false
      if (isSending && !wasSending) {
        setRecapDialogDigest(null)
        setRecapDialogSessionId(null)
      }
      wasSending = isSending
    })

    return unsubscribe
  }, [recapDialogSessionId])

  // Listen for keyboard shortcut events
  useEffect(() => {
    if (!enabled || !selectedCard) return

    const handleApprovePlanEvent = () => {
      if (
        selectedCard.hasExitPlanMode &&
        !selectedCard.hasQuestion &&
        !selectedCard.isSending
      ) {
        onPlanApproval(selectedCard)
      }
    }

    const handleApprovePlanYoloEvent = () => {
      if (
        selectedCard.hasExitPlanMode &&
        !selectedCard.hasQuestion &&
        !selectedCard.isSending
      ) {
        onPlanApprovalYolo(selectedCard)
      }
    }

    const handleOpenPlanEvent = () => {
      if (selectedCard.planFilePath || selectedCard.planContent) {
        handlePlanView(selectedCard)
      }
    }

    const handleOpenRecapEvent = () => {
      if (selectedCard.recapDigest) {
        handleRecapView(selectedCard)
      }
    }

    window.addEventListener('approve-plan', handleApprovePlanEvent)
    window.addEventListener('approve-plan-yolo', handleApprovePlanYoloEvent)
    window.addEventListener('open-plan', handleOpenPlanEvent)
    window.addEventListener('open-recap', handleOpenRecapEvent)

    return () => {
      window.removeEventListener('approve-plan', handleApprovePlanEvent)
      window.removeEventListener(
        'approve-plan-yolo',
        handleApprovePlanYoloEvent
      )
      window.removeEventListener('open-plan', handleOpenPlanEvent)
      window.removeEventListener('open-recap', handleOpenRecapEvent)
    }
  }, [
    enabled,
    selectedCard,
    onPlanApproval,
    onPlanApprovalYolo,
    handlePlanView,
    handleRecapView,
  ])

  return {
    planDialogPath,
    planDialogContent,
    planApprovalContext,
    planDialogCard,
    closePlanDialog,
    recapDialogDigest,
    closeRecapDialog,
    handlePlanView,
    handleRecapView,
  }
}
