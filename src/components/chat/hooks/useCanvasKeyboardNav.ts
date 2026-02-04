import { useCallback, useEffect, useRef } from 'react'
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
export function useCanvasKeyboardNav<T>({
  cards,
  selectedIndex,
  onSelectedIndexChange,
  onSelect,
  enabled,
  onSelectionChange,
}: UseCanvasKeyboardNavOptions<T>): UseCanvasKeyboardNavResult {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

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
      // Skip if magic modal is open
      if (useUIStore.getState().magicModalOpen) return

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
          if (selectedIndex < total - 1) {
            updateSelection(selectedIndex + 1)
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (selectedIndex > 0) {
            updateSelection(selectedIndex - 1)
          }
          break
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = findVerticalNeighbor(selectedIndex, 'down')
          if (nextIndex !== null) {
            updateSelection(nextIndex)
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prevIndex = findVerticalNeighbor(selectedIndex, 'up')
          if (prevIndex !== null) {
            updateSelection(prevIndex)
          }
          break
        }
        case 'Enter':
          // Only handle plain Enter (no modifiers) - CMD+Enter is for approve_plan keybinding
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          onSelect(selectedIndex)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    enabled,
    selectedIndex,
    cards.length,
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
