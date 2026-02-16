import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { VirtualizedMessageListHandle } from '../VirtualizedMessageList'
import type { ChatMessage } from '@/types/chat'

interface UseScrollManagementOptions {
  /** Messages array for finding findings index */
  messages: ChatMessage[] | undefined
  /** Ref to virtualized list for scrolling to specific message index */
  virtualizedListRef: RefObject<VirtualizedMessageListHandle | null>
}

interface UseScrollManagementReturn {
  /** Ref for ScrollArea viewport */
  scrollViewportRef: RefObject<HTMLDivElement | null>
  /** Whether user is at bottom of scroll */
  isAtBottom: boolean
  /** Whether findings are visible in viewport */
  areFindingsVisible: boolean
  /** Scroll to bottom with auto-scroll flag. Pass `true` for instant (no animation). */
  scrollToBottom: (instant?: boolean) => void
  /** Scroll to findings element */
  scrollToFindings: () => void
  /** Handler for onScroll event */
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void
  /** Callback when scroll-to-bottom is handled */
  handleScrollToBottomHandled: () => void
}

export function useScrollManagement({
  messages,
  virtualizedListRef,
}: UseScrollManagementOptions): UseScrollManagementReturn {
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  // State for tracking if user is at the bottom of scroll area
  const [isAtBottom, setIsAtBottom] = useState(true)
  // Ref to track scroll position without re-renders (for auto-scroll logic)
  const isAtBottomRef = useRef(true)
  // Ref to track if we're currently auto-scrolling (to avoid race conditions)
  const isAutoScrollingRef = useRef(false)
  // State for tracking if findings are visible in viewport
  const [areFindingsVisible, setAreFindingsVisible] = useState(true)
  // Ref for scroll timeout cleanup
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Handle scroll events to track if user is at bottom and if findings are visible
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // Skip updating isAtBottom during auto-scroll to avoid race conditions
    // This prevents the smooth scroll animation from incorrectly marking us as "not at bottom"
    if (isAutoScrollingRef.current) {
      return
    }

    const target = e.target as HTMLDivElement
    const { scrollTop, scrollHeight, clientHeight } = target
    // Consider "at bottom" if within 100px of the bottom
    const atBottom = scrollHeight - scrollTop - clientHeight < 100
    isAtBottomRef.current = atBottom
    setIsAtBottom(atBottom)

    // Check if findings element is visible in the viewport
    const findingsEl = target.querySelector('[data-review-findings="unfixed"]')
    if (findingsEl) {
      const rect = findingsEl.getBoundingClientRect()
      const containerRect = target.getBoundingClientRect()
      const isVisible =
        rect.top < containerRect.bottom && rect.bottom > containerRect.top
      setAreFindingsVisible(isVisible)
    } else {
      setAreFindingsVisible(true) // No unfixed findings, so don't show button
    }
  }, [])

  // Handle scroll-to-bottom completion from VirtualizedMessageList
  const handleScrollToBottomHandled = useCallback(() => {
    isAtBottomRef.current = true
    setIsAtBottom(true)
  }, [])

  // Scroll to bottom helper
  // Pass instant=true for user-initiated actions (answering questions, approving plans)
  // where DOM changes immediately and smooth scroll would target stale scrollHeight.
  // Default smooth is for auto-scroll during streaming.
  const scrollToBottom = useCallback((instant?: boolean) => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    // Clear existing timeout to prevent memory leaks
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    isAtBottomRef.current = true
    setIsAtBottom(true)

    if (instant) {
      // Instant scroll — no animation, no correction needed
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' })
      return
    }

    isAutoScrollingRef.current = true

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    })

    scrollTimeoutRef.current = setTimeout(() => {
      isAutoScrollingRef.current = false

      if (viewport) {
        // Correct scroll position if smooth scroll ended at wrong spot
        // (DOM changes during animation can cause stale scrollHeight targeting)
        const { scrollTop, scrollHeight, clientHeight } = viewport
        if (scrollHeight - scrollTop - clientHeight > 2) {
          viewport.scrollTo({ top: scrollHeight, behavior: 'instant' })
        }

        // Check findings visibility after scroll completes
        const findingsEl = viewport.querySelector(
          '[data-review-findings="unfixed"]'
        )
        if (findingsEl) {
          const rect = findingsEl.getBoundingClientRect()
          const containerRect = viewport.getBoundingClientRect()
          const isVisible =
            rect.top < containerRect.bottom && rect.bottom > containerRect.top
          setAreFindingsVisible(isVisible)
        } else {
          setAreFindingsVisible(true)
        }
      }
    }, 350)
  }, [])

  // Scroll to findings helper
  // First scroll to the message containing findings using virtualizer, then to the element
  const scrollToFindings = useCallback(() => {
    // First try to find the element directly (if already rendered)
    const findingsEl = scrollViewportRef.current?.querySelector(
      '[data-review-findings="unfixed"]'
    )
    if (findingsEl) {
      findingsEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    // If element not found, find which message has findings and scroll to it
    // The findings will be rendered once the message is in view
    const msgs = messages ?? []
    const msgWithFindings = msgs.findIndex(
      msg => msg.role === 'assistant' && msg.content?.includes('<finding')
    )
    if (msgWithFindings >= 0 && virtualizedListRef.current) {
      virtualizedListRef.current.scrollToIndex(msgWithFindings, {
        align: 'start',
      })
      // Clear existing timeout to prevent memory leaks
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      // After scroll completes, try to scroll to the actual findings element
      scrollTimeoutRef.current = setTimeout(() => {
        const el = scrollViewportRef.current?.querySelector(
          '[data-review-findings="unfixed"]'
        )
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
    }
  }, [messages, virtualizedListRef])

  return {
    scrollViewportRef,
    isAtBottom,
    areFindingsVisible,
    scrollToBottom,
    scrollToFindings,
    handleScroll,
    handleScrollToBottomHandled,
  }
}
