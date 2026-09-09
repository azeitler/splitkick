import { cn } from '@/lib/utils'

interface BaseSessionBadgeProps {
  className?: string
}

/**
 * Marks the base session of a project. The base session carries the default
 * branch as its name, so without this pill it reads as an ordinary workspace
 * called "main". Stays a `<span>`: the rows that host it are themselves
 * clickable, and a nested button is invalid HTML.
 */
export function BaseSessionBadge({ className }: BaseSessionBadgeProps) {
  return (
    <span
      data-testid="base-session-badge"
      className={cn(
        'ml-0.5 shrink-0 whitespace-nowrap rounded bg-muted-foreground/15 px-1 py-px text-[10px] font-medium leading-4 text-muted-foreground',
        className
      )}
    >
      Base Session
    </span>
  )
}
