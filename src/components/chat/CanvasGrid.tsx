import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { SessionCard } from './SessionCard'
import { SessionChatModal } from './SessionChatModal'
import { PlanDialog } from './PlanDialog'
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
  onPlanApproval: (card: SessionCardData) => void
  onPlanApprovalYolo: (card: SessionCardData) => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
}

/**
 * Shared canvas grid component with keyboard navigation and dialogs.
 * Used by both SessionCanvasView and WorktreeDashboard.
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
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  // Plan dialog state
  const [planDialogPath, setPlanDialogPath] = useState<string | null>(null)
  const [planDialogContent, setPlanDialogContent] = useState<string | null>(null)

  // Track session modal open state for magic command keybindings
  useEffect(() => {
    useUIStore.getState().setSessionChatModalOpen(
      !!selectedSessionId,
      selectedSessionId ? worktreeId : null
    )
  }, [selectedSessionId, worktreeId])

  // Track canvas selected session for magic menu
  const setCanvasSelectedSession = useChatStore.getState().setCanvasSelectedSession

  // Find the card visually below/above the current one (visual-position based)
  const findVerticalNeighbor = useCallback(
    (currentIndex: number, direction: 'up' | 'down'): number | null => {
      const currentRef = cardRefs.current[currentIndex]
      if (!currentRef) return null

      const currentRect = currentRef.getBoundingClientRect()
      const currentCenterX = currentRect.left + currentRect.width / 2

      let bestIndex: number | null = null
      let bestDistance = Infinity

      for (let i = 0; i < cardRefs.current.length; i++) {
        if (i === currentIndex) continue
        const ref = cardRefs.current[i]
        if (!ref) continue

        const rect = ref.getBoundingClientRect()

        // Check if card is in the correct direction
        if (direction === 'down' && rect.top <= currentRect.bottom) continue
        if (direction === 'up' && rect.bottom >= currentRect.top) continue

        // Calculate horizontal distance (how aligned it is)
        const cardCenterX = rect.left + rect.width / 2
        const horizontalDistance = Math.abs(cardCenterX - currentCenterX)

        // Calculate vertical distance
        const verticalDistance =
          direction === 'down'
            ? rect.top - currentRect.bottom
            : currentRect.top - rect.bottom

        // Prefer cards that are horizontally aligned and close vertically
        // Weight horizontal alignment more heavily
        const distance = horizontalDistance + verticalDistance * 0.5

        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = i
        }
      }

      return bestIndex
    },
    []
  )

  // Handle clicking on a session card - open modal
  const handleSessionClick = useCallback(
    (sessionId: string) => {
      onSelectedSessionIdChange(sessionId)
      setCanvasSelectedSession(worktreeId, sessionId)
    },
    [worktreeId, onSelectedSessionIdChange, setCanvasSelectedSession]
  )

  // Handle plan view
  const handlePlanView = useCallback((card: SessionCardData) => {
    if (card.planFilePath) {
      setPlanDialogPath(card.planFilePath)
      setPlanDialogContent(null)
    } else if (card.planContent) {
      setPlanDialogContent(card.planContent)
      setPlanDialogPath(null)
    }
  }, [])

  // Global keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if magic modal is open
      if (useUIStore.getState().magicModalOpen) return

      if (selectedSessionId) return
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return
      }

      const total = cards.length
      if (total === 0) return

      if (selectedIndex === null) {
        if (
          ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)
        ) {
          onSelectedIndexChange(0)
          const firstCard = cards[0]
          if (firstCard) {
            setCanvasSelectedSession(worktreeId, firstCard.session.id)
          }
          e.preventDefault()
        }
        return
      }

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          if (selectedIndex < total - 1) {
            const newIndex = selectedIndex + 1
            onSelectedIndexChange(newIndex)
            const card = cards[newIndex]
            if (card) {
              setCanvasSelectedSession(worktreeId, card.session.id)
            }
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1
            onSelectedIndexChange(newIndex)
            const card = cards[newIndex]
            if (card) {
              setCanvasSelectedSession(worktreeId, card.session.id)
            }
          }
          break
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = findVerticalNeighbor(selectedIndex, 'down')
          if (nextIndex !== null) {
            onSelectedIndexChange(nextIndex)
            const card = cards[nextIndex]
            if (card) {
              setCanvasSelectedSession(worktreeId, card.session.id)
            }
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prevIndex = findVerticalNeighbor(selectedIndex, 'up')
          if (prevIndex !== null) {
            onSelectedIndexChange(prevIndex)
            const card = cards[prevIndex]
            if (card) {
              setCanvasSelectedSession(worktreeId, card.session.id)
            }
          }
          break
        }
        case 'Enter':
          // Only handle plain Enter (no modifiers) - CMD+Enter is for approve_plan keybinding
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          if (cards[selectedIndex]) {
            handleSessionClick(cards[selectedIndex].session.id)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedIndex,
    selectedSessionId,
    cards,
    worktreeId,
    findVerticalNeighbor,
    handleSessionClick,
    onSelectedIndexChange,
    setCanvasSelectedSession,
  ])

  // Scroll selected card into view when selection changes
  useEffect(() => {
    if (selectedIndex === null) return
    const card = cardRefs.current[selectedIndex]
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIndex])

  // Listen for focus-canvas-search event
  useEffect(() => {
    const handleFocusSearch = () => searchInputRef?.current?.focus()
    window.addEventListener('focus-canvas-search', handleFocusSearch)
    return () => window.removeEventListener('focus-canvas-search', handleFocusSearch)
  }, [searchInputRef])

  // Listen for close-session-or-worktree event to handle CMD+W
  useEffect(() => {
    const handleCloseSessionOrWorktree = (e: Event) => {
      // If modal is open, close it
      if (selectedSessionId) {
        onSelectedSessionIdChange(null)
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

    window.addEventListener('close-session-or-worktree', handleCloseSessionOrWorktree, {
      capture: true,
    })
    return () =>
      window.removeEventListener(
        'close-session-or-worktree',
        handleCloseSessionOrWorktree,
        { capture: true }
      )
  }, [selectedSessionId, selectedIndex, cards, onArchiveSession, onSelectedIndexChange, onSelectedSessionIdChange])

  // Listen for keyboard shortcut events for selected session
  useEffect(() => {
    // Only handle when we have a keyboard-selected session and modal is not open
    if (selectedSessionId || selectedIndex === null) return

    const card = cards[selectedIndex]
    if (!card) return

    const handleApprovePlanEvent = () => {
      if (card.hasExitPlanMode && !card.hasQuestion) {
        onPlanApproval(card)
      }
    }

    const handleApprovePlanYoloEvent = () => {
      if (card.hasExitPlanMode && !card.hasQuestion) {
        onPlanApprovalYolo(card)
      }
    }

    const handleOpenPlanEvent = () => {
      if (card.planFilePath || card.planContent) {
        handlePlanView(card)
      }
    }

    window.addEventListener('approve-plan', handleApprovePlanEvent)
    window.addEventListener('approve-plan-yolo', handleApprovePlanYoloEvent)
    window.addEventListener('open-plan', handleOpenPlanEvent)

    return () => {
      window.removeEventListener('approve-plan', handleApprovePlanEvent)
      window.removeEventListener('approve-plan-yolo', handleApprovePlanYoloEvent)
      window.removeEventListener('open-plan', handleOpenPlanEvent)
    }
  }, [
    selectedSessionId,
    selectedIndex,
    cards,
    onPlanApproval,
    onPlanApprovalYolo,
    handlePlanView,
  ])

  return (
    <>
      <div className="flex flex-row flex-wrap gap-3">
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
          onClose={() => setPlanDialogPath(null)}
        />
      ) : planDialogContent ? (
        <PlanDialog
          content={planDialogContent}
          isOpen={true}
          onClose={() => setPlanDialogContent(null)}
        />
      ) : null}

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
