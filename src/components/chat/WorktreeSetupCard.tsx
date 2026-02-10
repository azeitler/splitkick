import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Worktree } from '@/types/projects'

export interface WorktreeSetupCardProps {
  worktree: Worktree
  isSelected?: boolean
  onSelect?: () => void
}

/**
 * Card shown in canvas views while a worktree is being set up (jean.json setup script running).
 * Matches SessionCard dimensions for consistent grid layout.
 */
export const WorktreeSetupCard = forwardRef<
  HTMLDivElement,
  WorktreeSetupCardProps
>(function WorktreeSetupCard({ worktree, isSelected, onSelect }, ref) {
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
          Running setup script...
        </span>
      </div>
    </div>
  )
})
