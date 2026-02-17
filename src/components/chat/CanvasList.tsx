import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { SessionListRow } from './SessionListRow'
import { LabelModal } from './LabelModal'
import { SessionChatModal } from './SessionChatModal'
import { PlanDialog } from './PlanDialog'
import { RecapDialog } from './RecapDialog'
import { CloseWorktreeDialog } from './CloseWorktreeDialog'
import { usePreferences } from '@/services/preferences'
import { useCanvasKeyboardNav } from './hooks/useCanvasKeyboardNav'
import { useCanvasShortcutEvents } from './hooks/useCanvasShortcutEvents'
import {
  type SessionCardData,
  groupCardsByStatus,
} from './session-card-utils'

interface CanvasListProps {
  cards: SessionCardData[]
  worktreeId: string
  worktreePath: string
  selectedIndex: number | null
  onSelectedIndexChange: (index: number | null) => void
  selectedSessionId: string | null
  onSelectedSessionIdChange: (id: string | null) => void
  onArchiveSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onPlanApproval: (card: SessionCardData, updatedPlan?: string) => void
  onPlanApprovalYolo: (card: SessionCardData, updatedPlan?: string) => void
  onCloseWorktree: () => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
}

/**
 * Compact list layout for canvas view. Same API as CanvasGrid.
 */
export function CanvasList({
  cards,
  worktreeId,
  worktreePath,
  selectedIndex,
  onSelectedIndexChange,
  selectedSessionId,
  onSelectedSessionIdChange,
  onArchiveSession,
  onDeleteSession,
  onPlanApproval,
  onPlanApprovalYolo,
  onCloseWorktree: _onCloseWorktree,
  searchInputRef,
}: CanvasListProps) {
  // Track session modal open state for magic command keybindings
  useEffect(() => {
    useUIStore
      .getState()
      .setSessionChatModalOpen(
        !!selectedSessionId,
        selectedSessionId ? worktreeId : null
      )
  }, [selectedSessionId, worktreeId])

  const setCanvasSelectedSession =
    useChatStore.getState().setCanvasSelectedSession

  // Use ref for cards to avoid stale closures in keyboard nav callbacks
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      onSelectedSessionIdChange(sessionId)
      setCanvasSelectedSession(worktreeId, sessionId)
    },
    [worktreeId, onSelectedSessionIdChange, setCanvasSelectedSession]
  )

  const handleSelect = useCallback(
    (index: number) => {
      const card = cardsRef.current[index]
      if (card) {
        handleSessionClick(card.session.id)
      }
    },
    [handleSessionClick]
  )

  const handleSelectionChange = useCallback(
    (index: number) => {
      const card = cardsRef.current[index]
      if (card) {
        setCanvasSelectedSession(worktreeId, card.session.id)
        useProjectsStore.getState().selectWorktree(worktreeId)
        useChatStore.getState().registerWorktreePath(worktreeId, worktreePath)
      }
    },
    [worktreeId, worktreePath, setCanvasSelectedSession]
  )

  const selectedCard =
    selectedIndex !== null ? (cards[selectedIndex] ?? null) : null

  const {
    planDialogPath,
    planDialogContent,
    planApprovalContext,
    planDialogCard,
    closePlanDialog,
    recapDialogDigest,
    isRecapDialogOpen,
    isGeneratingRecap,
    regenerateRecap,
    closeRecapDialog,
    handlePlanView,
    handleRecapView,
    isLabelModalOpen,
    labelModalSessionId,
    labelModalCurrentLabel,
    closeLabelModal,
    handleOpenLabelModal,
  } = useCanvasShortcutEvents({
    selectedCard,
    enabled: !selectedSessionId && selectedIndex !== null,
    worktreeId,
    worktreePath,
    onPlanApproval,
    onPlanApprovalYolo,
  })

  const isModalOpen =
    !!selectedSessionId ||
    !!planDialogPath ||
    !!planDialogContent ||
    isRecapDialogOpen ||
    isLabelModalOpen

  const { cardRefs } = useCanvasKeyboardNav({
    cards,
    selectedIndex,
    onSelectedIndexChange,
    onSelect: handleSelect,
    enabled: !isModalOpen,
    layout: 'list',
    onSelectionChange: handleSelectionChange,
  })

  const handleDialogApprove = useCallback(
    (updatedPlan: string) => {
      if (planDialogCard) {
        onPlanApproval(planDialogCard, updatedPlan)
      }
    },
    [planDialogCard, onPlanApproval]
  )

  const handleDialogApproveYolo = useCallback(
    (updatedPlan: string) => {
      if (planDialogCard) {
        onPlanApprovalYolo(planDialogCard, updatedPlan)
      }
    },
    [planDialogCard, onPlanApprovalYolo]
  )

  useEffect(() => {
    const handleFocusSearch = () => searchInputRef?.current?.focus()
    window.addEventListener('focus-canvas-search', handleFocusSearch)
    return () =>
      window.removeEventListener('focus-canvas-search', handleFocusSearch)
  }, [searchInputRef])

  // CMD+W handler (same as CanvasGrid)
  const { data: preferences } = usePreferences()
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const pendingDeleteSessionId = useRef<string | null>(null)

  const executeCloseAction = useCallback(() => {
    if (pendingDeleteSessionId.current) {
      onDeleteSession(pendingDeleteSessionId.current)
      pendingDeleteSessionId.current = null
    }
    setCloseConfirmOpen(false)
  }, [onDeleteSession])

  useEffect(() => {
    const handleCloseSessionOrWorktree = (e: Event) => {
      // If modal is open, SessionChatModal intercepts CMD+W and closes itself — skip here
      if (selectedSessionId) return

      // Close the selected session (not the whole worktree)
      if (selectedIndex !== null && cards[selectedIndex]) {
        e.stopImmediatePropagation()
        const sessionId = cards[selectedIndex].session.id
        if (preferences?.confirm_session_close !== false) {
          pendingDeleteSessionId.current = sessionId
          setCloseConfirmOpen(true)
        } else {
          onDeleteSession(sessionId)
        }
      }
    }

    window.addEventListener(
      'close-session-or-worktree',
      handleCloseSessionOrWorktree,
      { capture: true }
    )
    return () =>
      window.removeEventListener(
        'close-session-or-worktree',
        handleCloseSessionOrWorktree,
        { capture: true }
      )
  }, [
    selectedSessionId,
    selectedIndex,
    cards,
    onDeleteSession,
    preferences?.confirm_session_close,
  ])

  const groups = useMemo(() => groupCardsByStatus(cards), [cards])

  let indexOffset = 0

  return (
    <>
      <div className="flex flex-col gap-3">
        {groups.map(group => {
          const groupStartIndex = indexOffset
          indexOffset += group.cards.length
          return (
            <div key={group.key}>
              <div className="mb-1 flex items-baseline gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  {group.cards.length}
                </span>
              </div>
              <div className="flex flex-col">
                {group.cards.map((card, i) => {
                  const globalIndex = groupStartIndex + i
                  return (
                    <SessionListRow
                      key={card.session.id}
                      ref={el => {
                        cardRefs.current[globalIndex] = el
                      }}
                      card={card}
                      isSelected={selectedIndex === globalIndex}
                      onSelect={() => {
                        onSelectedIndexChange(globalIndex)
                        handleSessionClick(card.session.id)
                      }}
                      onArchive={() => onArchiveSession(card.session.id)}
                      onDelete={() => onDeleteSession(card.session.id)}
                      onPlanView={() => handlePlanView(card)}
                      onRecapView={() => handleRecapView(card)}
                      onApprove={() => onPlanApproval(card)}
                      onYolo={() => onPlanApprovalYolo(card)}
                      onToggleLabel={() => handleOpenLabelModal(card)}
                      onToggleReview={() => {
                        const { reviewingSessions, setSessionReviewing } = useChatStore.getState()
                        const isReviewing = reviewingSessions[card.session.id] || !!card.session.review_results
                        setSessionReviewing(card.session.id, !isReviewing)
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Plan Dialog */}
      {planDialogPath ? (
        <PlanDialog
          filePath={planDialogPath}
          isOpen={true}
          onClose={closePlanDialog}
          editable={true}
          disabled={planDialogCard?.isSending}
          approvalContext={planApprovalContext ?? undefined}
          onApprove={handleDialogApprove}
          onApproveYolo={handleDialogApproveYolo}
        />
      ) : planDialogContent ? (
        <PlanDialog
          content={planDialogContent}
          isOpen={true}
          onClose={closePlanDialog}
          editable={true}
          disabled={planDialogCard?.isSending}
          approvalContext={planApprovalContext ?? undefined}
          onApprove={handleDialogApprove}
          onApproveYolo={handleDialogApproveYolo}
        />
      ) : null}

      {/* Recap Dialog */}
      <RecapDialog
        digest={recapDialogDigest}
        isOpen={isRecapDialogOpen}
        onClose={closeRecapDialog}
        isGenerating={isGeneratingRecap}
        onRegenerate={regenerateRecap}
      />

      {/* Label Modal */}
      <LabelModal
        key={labelModalSessionId}
        isOpen={isLabelModalOpen}
        onClose={closeLabelModal}
        sessionId={labelModalSessionId}
        currentLabel={labelModalCurrentLabel}
      />

      {/* Session Chat Modal */}
      <SessionChatModal
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isOpen={!!selectedSessionId}
        onClose={() => onSelectedSessionIdChange(null)}
      />
      <CloseWorktreeDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        onConfirm={executeCloseAction}
      />
    </>
  )
}
