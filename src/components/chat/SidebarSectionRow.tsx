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
  expanded: boolean
  onToggle?: () => void
  /** Horizontal padding, so the row lines up with its neighbours in the tree. */
  className?: string
  testId?: string
}

/**
 * The collapsible parent row of a sidebar section such as Pinned or Starred.
 *
 * It takes a workspace row's geometry, hover and chevron, so a section reads as
 * a sibling of the rows around it rather than a caption pasted between them.
 * It is a native button: Enter and Space open and close it.
 */
export function SidebarSectionRow({
  icon,
  label,
  count,
  expanded,
  onToggle,
  className,
  testId,
}: SidebarSectionRowProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      data-testid={testId}
      className={cn(
        'group relative flex w-full cursor-pointer items-center gap-1.5 overflow-hidden py-1.5 pr-2 text-left text-muted-foreground transition-colors duration-150 hover:bg-accent/50 hover:text-foreground',
        className
      )}
    >
      {icon}
      <span className="flex flex-1 items-center gap-0.5 truncate text-sm">
        <span className="truncate">{label}</span>
        {!expanded && <CollapsedCountBadge count={count} noun="session" />}
        <span className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-50">
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
}
