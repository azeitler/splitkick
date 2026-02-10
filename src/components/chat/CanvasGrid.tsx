import { useCallback, useEffect } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { SessionCard } from './SessionCard'
import { SessionChatModal } from './SessionChatModal'
import { PlanDialog } from './PlanDialog'
import { RecapDialog } from './RecapDialog'
import { useCanvasKeyboardNav } from './hooks/useCanvasKeyboardNav'
import { useCanvasShortcutEvents } from './hooks/useCanvasShortcutEvents'
import type { SessionCardData } from './session-card-utils'

interface CanvasGridProps {
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
 * Shared canvas grid component with keyboard navigation and dialogs.
 * Used by SessionCanvasView for worktree-level session display.
 */
export function CanvasGrid({
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
}: CanvasGridProps) {
  // Track session modal open state for magic command keybindings
  useEffect(() => {
    useUIStore
      .getState()
      .setSessionChatModalOpen(
        !!selectedSessionId,
        selectedSessionId ? worktreeId : null
      )
  }, [selectedSessionId, worktreeId])

  // Track canvas selected session for magic menu
  const setCanvasSelectedSession =
    useChatStore.getState().setCanvasSelectedSession

  // Handle clicking on a session card - open modal
  const handleSessionClick = useCallback(
    (sessionId: string) => {
      onSelectedSessionIdChange(sessionId)
      setCanvasSelectedSession(worktreeId, sessionId)
    },
    [worktreeId, onSelectedSessionIdChange, setCanvasSelectedSession]
  )

  // Handle selection from keyboard nav
  const handleSelect = useCallback(
    (index: number) => {
      const card = cards[index]
      if (card) {
        handleSessionClick(card.session.id)
      }
    },
    [cards, handleSessionClick]
  )

  // Handle selection change for tracking in store
  const handleSelectionChange = useCallback(
    (index: number) => {
      const card = cards[index]
      if (card) {
        setCanvasSelectedSession(worktreeId, card.session.id)
        // Sync projects store so CMD+O uses the correct worktree
        useProjectsStore.getState().selectWorktree(worktreeId)
        // Register worktree path so OpenInModal can find it
        useChatStore.getState().registerWorktreePath(worktreeId, worktreePath)
      }
    },
    [cards, worktreeId, worktreePath, setCanvasSelectedSession]
  )

  // Get selected card for shortcut events
  const selectedCard =
    selectedIndex !== null ? (cards[selectedIndex] ?? null) : null

  // Shortcut events (plan, recap, approve) - must be before keyboard nav to get dialog states
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
  } = useCanvasShortcutEvents({
    selectedCard,
    enabled: !selectedSessionId && selectedIndex !== null,
    worktreeId,
    worktreePath,
    onPlanApproval,
    onPlanApprovalYolo,
  })

  // Keyboard navigation - disable when any modal/dialog is open
  const isModalOpen =
    !!selectedSessionId ||
    !!planDialogPath ||
    !!planDialogContent ||
    isRecapDialogOpen
  console.log(
    '[CanvasGrid] isModalOpen:',
    isModalOpen,
    'selectedSessionId:',
    selectedSessionId,
    'planDialogPath:',
    planDialogPath,
    'planDialogContent:',
    !!planDialogContent,
    'isRecapDialogOpen:',
    isRecapDialogOpen
  )
  const { cardRefs } = useCanvasKeyboardNav({
    cards,
    selectedIndex,
    onSelectedIndexChange,
    onSelect: handleSelect,
    enabled: !isModalOpen,
    onSelectionChange: handleSelectionChange,
  })

  // Handle approve from dialog (with updated plan content)
  const handleDialogApprove = useCallback(
    (updatedPlan: string) => {
      console.log(
        '[CanvasGrid] handleDialogApprove called, updatedPlan length:',
        updatedPlan?.length
      )
      console.log('[CanvasGrid] planDialogCard:', planDialogCard?.session?.id)
      if (planDialogCard) {
        onPlanApproval(planDialogCard, updatedPlan)
      } else {
        console.log(
          '[CanvasGrid] handleDialogApprove - planDialogCard is null!'
        )
      }
    },
    [planDialogCard, onPlanApproval]
  )

  const handleDialogApproveYolo = useCallback(
    (updatedPlan: string) => {
      console.log(
        '[CanvasGrid] handleDialogApproveYolo called, updatedPlan length:',
        updatedPlan?.length
      )
      console.log('[CanvasGrid] planDialogCard:', planDialogCard?.session?.id)
      if (planDialogCard) {
        onPlanApprovalYolo(planDialogCard, updatedPlan)
      } else {
        console.log(
          '[CanvasGrid] handleDialogApproveYolo - planDialogCard is null!'
        )
      }
    },
    [planDialogCard, onPlanApprovalYolo]
  )

  // Listen for focus-canvas-search event
  useEffect(() => {
    const handleFocusSearch = () => searchInputRef?.current?.focus()
    window.addEventListener('focus-canvas-search', handleFocusSearch)
    return () =>
      window.removeEventListener('focus-canvas-search', handleFocusSearch)
  }, [searchInputRef])

  // Listen for close-session-or-worktree event to handle CMD+W
  useEffect(() => {
    const handleCloseSessionOrWorktree = (e: Event) => {
      // If modal is open, archive the session and close modal with next card pre-selected
      if (selectedSessionId) {
        e.stopImmediatePropagation()
        onArchiveSession(selectedSessionId)
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

      // If there's a keyboard-selected session, archive it
      if (selectedIndex !== null && cards[selectedIndex]) {
        e.stopImmediatePropagation()
        const sessionId = cards[selectedIndex].session.id
        onArchiveSession(sessionId)

        // Move selection to previous card, or clear if none left
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
      {
        capture: true,
      }
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
    onArchiveSession,
    onSelectedIndexChange,
    onSelectedSessionIdChange,
  ])

  console.log(
    '[CanvasGrid] render - selectedIndex:',
    selectedIndex,
    'cards.length:',
    cards.length
  )
  if (cards.length > 0 && cards[0]) {
    console.log(
      '[CanvasGrid] render - cards[0].session.id:',
      cards[0].session.id
    )
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
        {cards.map((card, index) => (
          <SessionCard
            key={card.session.id}
            ref={el => {
              cardRefs.current[index] = el
            }}
            card={card}
            isSelected={selectedIndex === index}
            onSelect={() => {
              onSelectedIndexChange(index)
              handleSessionClick(card.session.id)
            }}
            onArchive={() => onArchiveSession(card.session.id)}
            onDelete={() => onDeleteSession(card.session.id)}
            onPlanView={() => handlePlanView(card)}
            onRecapView={() => handleRecapView(card)}
            onApprove={() => onPlanApproval(card)}
            onYolo={() => onPlanApprovalYolo(card)}
          />
        ))}
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
