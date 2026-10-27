import { useEffect, type RefObject } from 'react'
import {
  STACK_BOTTOM_ATTR,
  STICKY_ATTR,
  STUCK_ATTR,
  stickyTop,
} from './sidebar-sticky'

/** No stuck row sits lower than this below the scroller top, in px. */
const MAX_STACK_PX = 240

/**
 * Mark the stuck elements of the sidebar's sticky stack, and the lowest one,
 * which draws the hairline (see `sidebar-sticky.ts`).
 *
 * Runs at most once per frame, on scroll, on resize and when rows change.
 * Only elements near the top are measured, and attributes are only written
 * when they change.
 */
export function useSidebarStickyStack(
  containerRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    const scroller = containerRef.current
    if (!scroller) return

    let frame = 0
    const marked = new Set<HTMLElement>()
    let bottom: HTMLElement | null = null

    const update = () => {
      frame = 0
      const stuck = new Set<HTMLElement>()
      let lowest: HTMLElement | null = null
      let lowestBottom = -Infinity
      const box = scroller.getBoundingClientRect()

      if (scroller.scrollTop > 0) {
        for (const el of scroller.querySelectorAll<HTMLElement>(
          `[${STICKY_ATTR}]`
        )) {
          const rect = el.getBoundingClientRect()
          if (rect.top > box.top + MAX_STACK_PX) break
          if (rect.bottom <= box.top + 0.5) continue
          if (rect.top - box.top > stickyTop(el) + 0.5) continue
          stuck.add(el)
          if (rect.bottom > lowestBottom) {
            lowestBottom = rect.bottom
            lowest = el
          }
        }
      }

      for (const el of marked) {
        if (!stuck.has(el)) el.removeAttribute(STUCK_ATTR)
      }
      for (const el of stuck) {
        if (!marked.has(el)) el.setAttribute(STUCK_ATTR, '')
      }
      marked.clear()
      for (const el of stuck) marked.add(el)

      if (bottom !== lowest) {
        bottom?.removeAttribute(STACK_BOTTOM_ATTR)
        lowest?.setAttribute(STACK_BOTTOM_ATTR, '')
        bottom = lowest
      }
      if (lowest) {
        // The hairline spans the sidebar, not only the indented row.
        const x = lowest.getBoundingClientRect().left - box.left
        lowest.style.setProperty('--sb-x', `${x}px`)
      }
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    scroller.addEventListener('scroll', schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(scroller)
    // Expanding, collapsing or loading rows moves the stack without a scroll.
    const mutations = new MutationObserver(schedule)
    mutations.observe(scroller, { childList: true, subtree: true })
    schedule()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      resize.disconnect()
      mutations.disconnect()
    }
  }, [containerRef])
}
