import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Worktree } from '@/types/projects'

export interface WorktreeSetupCardProps {
  worktree: Worktree
  isSelected?: boolean
  onSelect?: () => void
  layout?: 'grid' | 'list'
}

function getStatusText(worktree: Worktree): string {
  if (worktree.pr_number) return `Checking out PR #${worktree.pr_number}...`
  if (worktree.issue_number) return 'Setting up branch...'
  return 'Running setup script...'
}

/**
 * Card shown in canvas views while a worktree is being set up (jean.json setup script running).
 * Matches SessionCard dimensions for consistent grid layout, or list layout for list view.
 */
export const WorktreeSetupCard = forwardRef<
  HTMLDivElement,
  WorktreeSetupCardProps
>(function WorktreeSetupCard(
  { worktree, isSelected, onSelect, layout = 'grid' },
  ref
) {
  const statusText = getStatusText(worktree)

  if (layout === 'list') {
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={-1}
        onClick={onSelect}
        className={cn(
          'group flex w-full items-center gap-3 rounded-md px-3 py-1.5 border border-transparent transition-colors text-left cursor-pointer scroll-mt-28 scroll-mb-20',
          'animate-pulse hover:bg-muted/50 hover:border-foreground/10',
          isSelected &&
            'border-primary/50 bg-primary/5 hover:border-primary/50 hover:bg-primary/10'
        )}
      >
        {/* Spinner */}
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />

        {/* Worktree name */}
        <span className="flex-1 truncate text-sm text-muted-foreground">
          {worktree.name}
        </span>

        {/* Status text */}
        <span className="text-xs text-muted-foreground shrink-0">
          {statusText}
        </span>
      </div>
    )
  }

  // Grid layout (default)
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      onClick={onSelect}
      className={cn(
        'group flex w-full sm:w-[260px] min-h-[132px] flex-col gap-3 rounded-md overflow-hidden bg-muted/30 border p-4 transition-colors text-left cursor-default scroll-mt-28 scroll-mb-20',
        'animate-pulse',
        isSelected &&
          'border-primary bg-primary/5 hover:border-primary hover:bg-primary/10'
      )}
    >
      {/* Top row: spinner + status */}
      <div className="flex items-center gap-2 min-h-5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs font-medium uppercase text-muted-foreground">
          Setting up
        </span>
      </div>

      {/* Worktree name */}
      <div className="text-sm font-medium leading-snug text-muted-foreground">
        {worktree.name}
      </div>

      {/* Bottom section: status text */}
      <div className="flex items-center gap-1.5 mt-auto">
        <span className="text-xs text-muted-foreground">
          {statusText}
        </span>
      </div>
    </div>
  )
})
