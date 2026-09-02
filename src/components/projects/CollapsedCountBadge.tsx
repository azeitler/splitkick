import { cn } from '@/lib/utils'

interface CollapsedCountBadgeProps {
  /** Number of children that the collapsed row hides */
  count: number
  /** Singular noun for the accessible label, e.g. "session" */
  noun: string
  className?: string
}

/**
 * Small count pill for a collapsed tree row, so the number of hidden children
 * stays visible. Renders nothing when there is nothing to hide. Expanded rows
 * must not render it — the children are already on screen.
 */
export function CollapsedCountBadge({
  count,
  noun,
  className,
}: CollapsedCountBadgeProps) {
  if (count < 1) return null

  return (
    <span
      data-testid="collapsed-count-badge"
      aria-label={`${count} ${noun}${count === 1 ? '' : 's'}`}
      className={cn(
        'ml-0.5 shrink-0 rounded bg-muted-foreground/15 px-1 py-px text-[10px] font-medium leading-4 text-muted-foreground',
        className
      )}
    >
      {count}
    </span>
  )
}
