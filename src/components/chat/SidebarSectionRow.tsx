import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { CollapsedCountBadge } from '@/components/projects/CollapsedCountBadge'
import { cn } from '@/lib/utils'

interface SidebarSectionRowProps {
  /** Small leading glyph, in the slot a workspace row gives its status dot. */
  icon: ReactNode
  label: string
  /** Rows the section holds; shown as a badge while collapsed. */
  count: number
  /** Singular noun for the count badge's accessible label. */
  noun?: string
  expanded: boolean
  onToggle?: () => void
  /** Buttons at the right edge, e.g. "+ New". Rendered beside the toggle, not
   *  inside it, so they never open or close the section. */
  actions?: ReactNode
  /** Horizontal padding, so the row lines up with its neighbours in the tree. */
  className?: string
  testId?: string
}

/**
 * The collapsible parent row of a sidebar section such as Starred, Folders or
 * Projects.
 *
 * It takes a workspace row's geometry, hover and chevron, so a section reads as
 * a sibling of the rows around it rather than a caption pasted between them.
 * The toggle is a native button: Enter and Space open and close it.
 */
export function SidebarSectionRow({
  icon,
  label,
  count,
  noun = 'session',
  expanded,
  onToggle,
  actions,
  className,
  testId,
}: SidebarSectionRowProps) {
  const toggle = (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      data-testid={testId}
      className={cn(
        // 2rem, as py-1.5 + text-sm; the projects sidebar shrinks it on a
        // short window (--sb-sec-h, App.css).
        'group relative flex h-[var(--sb-sec-h,2rem)] w-full cursor-pointer items-center gap-1.5 overflow-hidden py-1.5 pr-2 text-left text-muted-foreground transition-colors duration-150 hover:text-foreground',
        // With actions, the wrapper carries the hover background and the
        // padding; the toggle keeps the Home row's gap, so the label sits on
        // the Home label's column.
        !actions && 'hover:bg-accent/50',
        actions ? 'min-w-0 flex-1 gap-1' : className
      )}
    >
      {icon}
      <span className="flex flex-1 items-center gap-0.5 truncate text-sm">
        <span className="truncate">{label}</span>
        {!expanded && <CollapsedCountBadge count={count} noun={noun} />}
        <span className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/section:opacity-50 group-hover:opacity-50">
          <ChevronDown
            className={cn(
              'size-3 transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </span>
      </span>
    </button>
  )

  if (!actions) return toggle

  return (
    <div
      className={cn(
        'group/section flex w-full items-center transition-colors duration-150 hover:bg-accent/50',
        className
      )}
    >
      {toggle}
      <div className="flex shrink-0 items-center gap-0.5 pr-2">{actions}</div>
    </div>
  )
}
