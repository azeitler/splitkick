import { CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LinkedIssueBadgeProps {
  /** GitHub issue number that the parent workspace is linked to */
  issueNumber?: number
  className?: string
}

/**
 * Small pill that shows the GitHub issue a workspace was created from. The link
 * lives on the worktree, so every session row of that workspace shows the same
 * number. Renders nothing when no issue is linked.
 *
 * Stays a <span>: the session row is a <button>, and a button inside a button is
 * invalid HTML. Use the session context menu for an "open issue" action.
 */
export function LinkedIssueBadge({
  issueNumber,
  className,
}: LinkedIssueBadgeProps) {
  if (!issueNumber) return null

  return (
    <span
      data-testid="linked-issue-badge"
      aria-label={`GitHub issue ${issueNumber}`}
      title={`Linked GitHub issue #${issueNumber}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded bg-green-500/10 px-1 py-px text-[10px] font-medium leading-4 text-green-500',
        className
      )}
    >
      <CircleDot className="h-2.5 w-2.5" />
      {issueNumber}
    </span>
  )
}
