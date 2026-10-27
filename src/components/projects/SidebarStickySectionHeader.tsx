import { useCallback, useRef, type ComponentProps } from 'react'
import { SidebarSectionRow } from '@/components/chat/SidebarSectionRow'
import { scrollToSlot } from './sidebar-sticky'

interface SidebarStickySectionHeaderProps extends ComponentProps<
  typeof SidebarSectionRow
> {
  /** The header's slot in the stack, a CSS length such as
   *  `var(--sb-folders-top)`. */
  top: string
}

/**
 * A section header of the projects sidebar that stays stuck in its slot once
 * you scroll past it (see `sidebar-sticky.ts`).
 *
 * While it is stuck, a click jumps back to the start of its section instead of
 * collapsing it: the section is off screen, and collapsing it there would be
 * invisible. A header that is not stuck toggles, as before.
 */
export function SidebarStickySectionHeader({
  top,
  onToggle,
  ...row
}: SidebarStickySectionHeaderProps) {
  // Zero-height marker at the header's natural position: a stuck header sits
  // below it, and it is the target of the jump.
  const anchorRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  const handleToggle = useCallback(() => {
    const anchor = anchorRef.current
    const header = headerRef.current
    if (
      anchor &&
      header &&
      header.getBoundingClientRect().top - anchor.getBoundingClientRect().top >
        0.5
    ) {
      scrollToSlot(header, anchor)
      return
    }
    onToggle?.()
  }, [onToggle])

  return (
    <>
      <div ref={anchorRef} aria-hidden="true" />
      <div
        ref={headerRef}
        data-sidebar-sticky=""
        className="sticky z-[4] bg-sidebar"
        style={{ top }}
      >
        <SidebarSectionRow {...row} onToggle={handleToggle} />
      </div>
    </>
  )
}
