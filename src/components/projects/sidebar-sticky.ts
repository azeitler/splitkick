/**
 * The sidebar's sticky stack (#45).
 *
 * Section headers (Starred, Folders, Projects) and the folder, project and
 * worktree rows are `position: sticky`; their `top` values come from CSS
 * variables on the scroller (`.sidebar-sticky-scroll` in App.css). Each row
 * sticks inside its own wrapper, so the end of a project or worktree pushes its
 * row out. The section headers share one containing block (their section
 * wrappers are `display: contents`), so a header you scroll past stays stuck.
 *
 * CSS alone cannot tell whether a sticky element is stuck: scroll-state
 * container queries are not in WebKit. `useSidebarStickyStack` marks stuck
 * elements for the hairline; the helpers below read the layout directly.
 */

/** Marks a sticky element of the stack. */
export const STICKY_ATTR = 'data-sidebar-sticky'
/** Set by `useSidebarStickyStack` while the element is stuck. */
export const STUCK_ATTR = 'data-sidebar-stuck'
/** Set on the lowest stuck element: it draws the hairline. */
export const STACK_BOTTOM_ATTR = 'data-sidebar-stack-bottom'
/** Marks the scroller that holds the stack. */
export const STICKY_SCROLL_ATTR = 'data-sidebar-sticky-scroll'

/** `top` of a sticky element in px, as resolved from the CSS variables. */
export function stickyTop(el: HTMLElement): number {
  return parseFloat(getComputedStyle(el).top) || 0
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Scroll so that `target` (an element at the sticky element's natural
 * position) sits in the sticky element's slot.
 */
export function scrollToSlot(
  sticky: HTMLElement,
  target: HTMLElement,
  smooth = true
): void {
  const scroller = sticky.closest<HTMLElement>(`[${STICKY_SCROLL_ATTR}]`)
  if (!scroller) return
  const delta =
    target.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    stickyTop(sticky)
  scroller.scrollTo({
    top: scroller.scrollTop + delta,
    behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
  })
}

/**
 * Collapsing a stuck project or worktree moves its row to its natural
 * position, which is above the viewport: the row would vanish. Call this
 * before the toggle; it keeps the row in its slot afterwards.
 */
export function keepStuckRowInSlot(sticky: HTMLElement | null): void {
  if (!sticky?.hasAttribute(STUCK_ATTR)) return
  const block = sticky.parentElement
  if (!block) return
  // After React has committed the collapse, the wrapper starts at the row.
  requestAnimationFrame(() => scrollToSlot(sticky, block, false))
}
