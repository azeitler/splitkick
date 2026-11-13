import { useEffect, type RefObject } from 'react'
import { useUIStore } from '@/store/ui-store'

/** How long to keep looking for the row before giving up, in milliseconds. */
const REVEAL_DEADLINE_MS = 1000
/** How long the row must stay put before the scroll, in milliseconds. */
const REVEAL_SETTLE_MS = 150

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Scroll the row a programmatic navigation asked for into view, once.
 *
 * The row often does not exist yet when the navigation happens — its project
 * or workspace was collapsed, or its session list is still loading — so the
 * lookup is retried each frame until the row appears or the deadline passes.
 * Rows above it can still be loading (a project's Starred group, a session
 * list), and a smooth scroll keeps the target it started with; so the scroll
 * waits until the row has stayed at the same place for `REVEAL_SETTLE_MS`.
 * Exactly one reveal happens per navigation, so scrolling away afterwards is
 * never undone.
 */
export function useSidebarReveal(
  containerRef: RefObject<HTMLElement | null>
): void {
  const revealId = useUIStore(state => state.pendingSidebarRevealId)

  useEffect(() => {
    if (!revealId) return

    let frame = 0
    const deadline = Date.now() + REVEAL_DEADLINE_MS

    // The row's place in the scrolled content, and since when it has been there.
    let lastOffset: number | null = null
    let stableSince = 0

    const attempt = () => {
      const container = containerRef.current
      const row = container?.querySelector(
        `[data-sidebar-row-id="${CSS.escape(revealId)}"]`
      )
      const now = Date.now()
      if (row && container) {
        const offset =
          row.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop
        if (offset !== lastOffset) {
          lastOffset = offset
          stableSince = now
        }
        if (now - stableSince >= REVEAL_SETTLE_MS || now >= deadline) {
          row.scrollIntoView({
            block: 'nearest',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          })
          useUIStore.getState().clearSidebarReveal(revealId)
          return
        }
      } else if (now >= deadline) {
        useUIStore.getState().clearSidebarReveal(revealId)
        return
      }
      frame = requestAnimationFrame(attempt)
    }

    frame = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(frame)
  }, [revealId, containerRef])
}
