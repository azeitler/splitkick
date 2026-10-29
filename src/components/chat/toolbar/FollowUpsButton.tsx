import { ListTodo } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { isNativeApp } from '@/lib/environment'
import { cn } from '@/lib/utils'

interface FollowUpsButtonProps {
  /** Open (not done) items; shown as a badge when above 0. */
  openCount: number
  open: boolean
  onToggle: () => void
  /** Display form of the add-follow-up shortcut. */
  shortcut?: string
}

/** Toggles the follow-up list (#46). Sits at the far right, after Send (#66). */
export function FollowUpsButton({
  openCount,
  open,
  onToggle,
  shortcut,
}: FollowUpsButtonProps) {
  const isMobile = useIsMobile()
  const showShortcut = !!shortcut && isNativeApp() && !isMobile

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={
            openCount > 0 ? `Follow-ups (${openCount} open)` : 'Follow-ups'
          }
          aria-pressed={open}
          onClick={onToggle}
          className={cn(
            isMobile ? 'h-11 w-11' : 'h-8 w-8',
            'relative flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground',
            open && 'bg-muted text-foreground'
          )}
        >
          <ListTodo className="h-4 w-4" />
          {openCount > 0 && (
            <span
              data-testid="follow-ups-badge"
              className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground tabular-nums"
            >
              {openCount > 99 ? '99+' : openCount}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Follow-ups
        {showShortcut && (
          <Kbd className="ml-1.5 h-4 text-[10px]">{shortcut}</Kbd>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
