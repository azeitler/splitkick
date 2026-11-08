import { ChevronDown, Clock, Repeat } from 'lucide-react'
import { getModifierSymbol, isClientMacOS } from '@/lib/platform'
import { cn } from '@/lib/utils'
import type { ScheduleKind } from '@/lib/schedule-compose'
import { Kbd } from '@/components/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'

interface SendCancelButtonProps {
  isSending: boolean
  canSend: boolean
  /** When true, the secondary action steers into the running turn instead of queueing. */
  willSteer?: boolean
  /** When true, steering requires the primary modifier plus Enter. */
  steerWithModifier?: boolean
  queuedMessageCount?: number
  onCancel: () => void
  /** Adds a menu to Send with *Send later…* and *Repeat…* (#38). */
  onSchedule?: (kind: ScheduleKind) => void
}

export function SendCancelButton({
  isSending,
  canSend,
  willSteer = false,
  steerWithModifier = false,
  queuedMessageCount,
  onCancel,
  onSchedule,
}: SendCancelButtonProps) {
  const isMobile = useIsMobile()
  // Send / Cancel is the most-tapped control in the composer.
  const heightClass = isMobile ? 'h-11' : 'h-8'

  if (isSending) {
    const cancelButton = (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              heightClass,
              'flex items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            <span>{queuedMessageCount ? 'Skip to Next' : 'Cancel'}</span>
            {!isMobile && (
              <Kbd className="ml-0.5 h-4 text-[10px] bg-primary-foreground/20 text-primary-foreground">
                {isClientMacOS ? `${getModifierSymbol()}⌥⌫` : 'Ctrl+Alt+⌫'}
              </Kbd>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {queuedMessageCount
            ? `Skip to next queued message (${isClientMacOS ? `${getModifierSymbol()}+Option+Backspace` : 'Ctrl+Alt+Backspace'})`
            : `Cancel (${isClientMacOS ? `${getModifierSymbol()}+Option+Backspace` : 'Ctrl+Alt+Backspace'})`}
        </TooltipContent>
      </Tooltip>
    )

    if (canSend) {
      const actionLabel = willSteer ? 'Steer' : 'Queue'
      const actionShortcut = steerWithModifier
        ? isClientMacOS
          ? `${getModifierSymbol()}↵`
          : `${getModifierSymbol()}+Enter`
        : 'Enter'
      const actionTooltip = willSteer
        ? isMobile
          ? 'Steer into running turn'
          : `Steer into running turn (${actionShortcut})`
        : isMobile
          ? 'Queue message'
          : 'Queue message (Enter)'

      return (
        <div className="flex items-center">
          {cancelButton}
          <div className="h-4 w-px shrink-0 bg-border/50" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="submit"
                aria-label={actionLabel}
                className={cn(
                  heightClass,
                  'rounded-md flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-colors text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
              >
                <span>{actionLabel}</span>
                {!isMobile && (
                  <Kbd className="h-4 text-[10px]">{actionShortcut}</Kbd>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{actionTooltip}</TooltipContent>
          </Tooltip>
        </div>
      )
    }

    return cancelButton
  }

  const colorClass = canSend
    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
  const sendButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="submit"
          disabled={!canSend}
          className={cn(
            heightClass,
            'flex items-center justify-center rounded-md px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
            onSchedule && 'rounded-r-none',
            colorClass
          )}
        >
          <span>Send</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {isMobile ? 'Send message' : 'Send message (Enter)'}
      </TooltipContent>
    </Tooltip>
  )
  if (!onSchedule) return sendButton

  return (
    <div className="flex items-center">
      {sendButton}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!canSend}
            aria-label="More send options"
            className={cn(
              heightClass,
              'flex items-center justify-center rounded-md rounded-l-none px-1.5 transition-colors disabled:pointer-events-none disabled:opacity-50',
              canSend && 'border-l border-l-primary-foreground/20',
              colorClass
            )}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onSchedule('once')}>
            <Clock className="h-4 w-4" />
            Send later…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSchedule('repeat')}>
            <Repeat className="h-4 w-4" />
            Repeat…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
