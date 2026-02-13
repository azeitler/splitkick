import { useCallback, useEffect, useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { SessionListRow } from './SessionListRow'
import { LabelModal } from './LabelModal'
import { SessionChatModal } from './SessionChatModal'
import { PlanDialog } from './PlanDialog'
import { RecapDialog } from './RecapDialog'
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
  onOpenFullView: () => void
  onArchiveSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onPlanApproval: (card: SessionCardData, updatedPlan?: string) => void
  onPlanApprovalYolo: (card: SessionCardData, updatedPlan?: string) => void
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
  onOpenFullView,
  onArchiveSession,
  onDeleteSession,
  onPlanApproval,
  onPlanApprovalYolo,
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

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      onSelectedSessionIdChange(sessionId)
      setCanvasSelectedSession(worktreeId, sessionId)
    },
    [worktreeId, onSelectedSessionIdChange, setCanvasSelectedSession]
  )

  const handleSelect = useCallback(
    (index: number) => {
      const card = cards[index]
      if (card) {
        handleSessionClick(card.session.id)
      }
    },
    [cards, handleSessionClick]
  )

  const handleSelectionChange = useCallback(
    (index: number) => {
      const card = cards[index]
      if (card) {
        setCanvasSelectedSession(worktreeId, card.session.id)
        useProjectsStore.getState().selectWorktree(worktreeId)
        useChatStore.getState().registerWorktreePath(worktreeId, worktreePath)
      }
    },
    [cards, worktreeId, worktreePath, setCanvasSelectedSession]
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
  useEffect(() => {
    const handleCloseSessionOrWorktree = (e: Event) => {
      if (selectedSessionId) {
        e.stopImmediatePropagation()
        onDeleteSession(selectedSessionId)
        onSelectedSessionIdChange(null)

        const closingIndex = cards.findIndex(
          c => c.session.id === selectedSessionId
        )
        const remaining = cards.filter(c => c.session.id !== selectedSessionId)

        if (remaining.length === 0) {
          onSelectedIndexChange(null)
        } else {
          const nextCard =
            closingIndex < remaining.length
              ? remaining[closingIndex]
              : remaining[remaining.length - 1]
          if (nextCard) {
            const newIndex = cards.findIndex(
              c => c.session.id === nextCard.session.id
            )
            onSelectedIndexChange(
              newIndex > closingIndex ? newIndex - 1 : newIndex
            )
          }
        }
        return
      }

      if (selectedIndex !== null && cards[selectedIndex]) {
        e.stopImmediatePropagation()
        const sessionId = cards[selectedIndex].session.id
        onDeleteSession(sessionId)

        const total = cards.length
        if (total <= 1) {
          onSelectedIndexChange(null)
        } else if (selectedIndex >= total - 1) {
          onSelectedIndexChange(selectedIndex - 1)
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
    onSelectedIndexChange,
    onSelectedSessionIdChange,
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
        sessionId={selectedSessionId}
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isOpen={!!selectedSessionId}
        onClose={() => onSelectedSessionIdChange(null)}
        onOpenFullView={onOpenFullView}
      />
    </>
  )
}
