import { useEffect, type RefObject } from 'react'
import { useUIStore } from '@/store/ui-store'

/** How long to keep looking for the row before giving up, in milliseconds. */
const REVEAL_DEADLINE_MS = 1000

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

    const attempt = () => {
      const row = containerRef.current?.querySelector(
        `[data-sidebar-row-id="${CSS.escape(revealId)}"]`
      )
      if (row) {
        row.scrollIntoView({
          block: 'nearest',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
        useUIStore.getState().clearSidebarReveal(revealId)
        return
      }
      if (Date.now() >= deadline) {
        useUIStore.getState().clearSidebarReveal(revealId)
        return
      }
      frame = requestAnimationFrame(attempt)
    }

    frame = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(frame)
  }, [revealId, containerRef])
}
