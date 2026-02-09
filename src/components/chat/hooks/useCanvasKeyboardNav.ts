import { useCallback, useEffect, useRef } from 'react'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

interface UseCanvasKeyboardNavOptions<T> {
  /** Array of cards/items to navigate */
  cards: T[]
  /** Current selected index */
  selectedIndex: number | null
  /** Callback when selection changes */
  onSelectedIndexChange: (index: number | null) => void
  /** Callback when Enter is pressed on selected item */
  onSelect: (index: number) => void
  /** Whether keyboard navigation is enabled (disable when modal open) */
  enabled: boolean
  /** Optional callback when selection changes (for tracking in store) */
  onSelectionChange?: (index: number) => void
}

interface UseCanvasKeyboardNavResult {
  /** Refs array for card elements (needed for vertical neighbor finding) */
  cardRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
  /** Scroll selected card into view */
  scrollSelectedIntoView: () => void
}

/**
 * Shared keyboard navigation hook for canvas views.
 * Handles arrow keys, Enter, and visual-position-based vertical navigation.
 */
const THROTTLE_MS = 50

export function useCanvasKeyboardNav<T>({
  cards,
  selectedIndex,
  onSelectedIndexChange,
  onSelect,
  enabled,
  onSelectionChange,
}: UseCanvasKeyboardNavOptions<T>): UseCanvasKeyboardNavResult {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  // Use refs to avoid stale closures in event handler
  const selectedIndexRef = useRef(selectedIndex)
  // eslint-disable-next-line react-hooks/refs
  selectedIndexRef.current = selectedIndex

  const cardsLengthRef = useRef(cards.length)
  // eslint-disable-next-line react-hooks/refs
  cardsLengthRef.current = cards.length

  // Throttle rapid key presses
  const lastKeyTimeRef = useRef(0)

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

  // Global keyboard navigation
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if any modal is open (magic, plan dialog, etc.)
      const uiState = useUIStore.getState()
      console.log(
        '[useCanvasKeyboardNav] keydown',
        e.key,
        'magicModalOpen:',
        uiState.magicModalOpen,
        'planDialogOpen:',
        uiState.planDialogOpen,
        'commandPaletteOpen:',
        uiState.commandPaletteOpen,
        'enabled:',
        enabled
      )
      if (
        uiState.magicModalOpen ||
        uiState.planDialogOpen ||
        uiState.commandPaletteOpen ||
        uiState.preferencesOpen
      )
        return
      if (useProjectsStore.getState().projectSettingsDialogOpen) return

      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return
      }

      // Throttle rapid key presses to prevent skipping
      const now = Date.now()
      if (now - lastKeyTimeRef.current < THROTTLE_MS) return
      lastKeyTimeRef.current = now

      // Use refs to get current values (avoids stale closures)
      const currentIndex = selectedIndexRef.current
      const total = cardsLengthRef.current
      if (total === 0) return

      if (currentIndex === null) {
        if (
          ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)
        ) {
          onSelectedIndexChange(0)
          onSelectionChange?.(0)
          e.preventDefault()
        }
        return
      }

      const updateSelection = (newIndex: number) => {
        onSelectedIndexChange(newIndex)
        onSelectionChange?.(newIndex)
      }

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          if (currentIndex < total - 1) {
            updateSelection(currentIndex + 1)
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (currentIndex > 0) {
            updateSelection(currentIndex - 1)
          }
          break
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = findVerticalNeighbor(currentIndex, 'down')
          if (nextIndex !== null) {
            updateSelection(nextIndex)
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prevIndex = findVerticalNeighbor(currentIndex, 'up')
          if (prevIndex !== null) {
            updateSelection(prevIndex)
          }
          break
        }
        case 'Enter':
          // Only handle plain Enter (no modifiers) - CMD+Enter is for approve_plan keybinding
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          onSelect(currentIndex)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    enabled,
    findVerticalNeighbor,
    onSelectedIndexChange,
    onSelect,
    onSelectionChange,
  ])

  // Scroll selected card into view when selection changes
  const scrollSelectedIntoView = useCallback(() => {
    if (selectedIndex === null) return
    const card = cardRefs.current[selectedIndex]
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIndex])

  // Auto-scroll on selection change
  useEffect(() => {
    scrollSelectedIntoView()
  }, [scrollSelectedIntoView])

  return {
    cardRefs,
    scrollSelectedIntoView,
  }
}
