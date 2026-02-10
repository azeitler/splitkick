import { forwardRef } from 'react'
import { Archive, FileText, Shield, Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { formatShortcutDisplay, DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { type SessionCardData, statusConfig } from './session-card-utils'

export interface SessionCardProps {
  card: SessionCardData
  isSelected: boolean
  onSelect: () => void
  onArchive: () => void
  onDelete: () => void
  onPlanView: () => void
  onRecapView: () => void
  onApprove?: () => void
  onYolo?: () => void
}

export const SessionCard = forwardRef<HTMLDivElement, SessionCardProps>(
  function SessionCard(
    {
      card,
      isSelected,
      onSelect,
      onArchive,
      onDelete,
      onPlanView,
      onRecapView,
      onApprove,
      onYolo,
    },
    ref
  ) {
    const config = statusConfig[card.status]

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={ref}
            role="button"
            tabIndex={-1}
            onClick={onSelect}
            className={cn(
              'group flex w-full sm:w-[260px] min-h-[132px] flex-col gap-3 rounded-md overflow-hidden bg-muted/30 border p-4 transition-colors text-left cursor-pointer scroll-mt-28 scroll-mb-20',
              'hover:border-foreground/20 hover:bg-muted/50',
              isSelected &&
                'border-primary/50 bg-primary/5 hover:border-primary/50 hover:bg-primary/10 opacity-100'
            )}
          >
            {/* Top row: status indicator + plan/recap buttons */}
            <div className="flex items-center justify-between gap-2 min-h-5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase">
                <StatusIndicator
                  status={config.indicatorStatus}
                  variant={config.indicatorVariant}
                  className="h-2.5 w-2.5"
                />
                <span>Session</span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Recap button - only shown when recap exists */}
                {card.hasRecap && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative z-10 h-5 w-5"
                        onClick={e => {
                          e.stopPropagation()
                          onRecapView()
                        }}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View recap (R)</TooltipContent>
                  </Tooltip>
                )}
                {/* Plan button - only shown when plan exists */}
                {(card.planFilePath || card.planContent) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative z-10 h-5 w-5"
                        onClick={e => {
                          e.stopPropagation()
                          onPlanView()
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View plan (P)</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Session name */}
            <div className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.75em]">
              {card.session.name}
            </div>

            {/* Bottom section: status badge + actions */}
            <div className="flex flex-col gap-2">
              {/* Status row */}
              <div className="flex items-center gap-1.5">
                {/* Permission denials indicator */}
                {card.hasPermissionDenials && (
                  <span className="flex items-center h-6 px-2 text-[10px] uppercase tracking-wide border border-yellow-500/50 text-yellow-600 dark:text-yellow-400 rounded">
                    <Shield className="mr-1 h-3 w-3" />
                    {card.permissionDenialCount} blocked
                  </span>
                )}
              </div>

              {/* Actions row - Approve buttons for ExitPlanMode */}
              {card.hasExitPlanMode &&
                !card.hasQuestion &&
                onApprove &&
                onYolo && (
                  <div className="relative z-10 flex items-center gap-1.5">
                    <Button
                      className="h-6 px-2 text-xs rounded  "
                      disabled={card.isSending}
                      onClick={e => {
                        e.stopPropagation()
                        onApprove()
                      }}
                    >
                      Approve
                      <Kbd className="ml-1.5 h-4 text-[10px] bg-primary-foreground/20 text-primary-foreground">
                        {formatShortcutDisplay(
                          DEFAULT_KEYBINDINGS.approve_plan
                        )}
                      </Kbd>
                    </Button>
                    <Button
                      variant="destructive"
                      className="h-6 px-2 text-xs rounded"
                      disabled={card.isSending}
                      onClick={e => {
                        e.stopPropagation()
                        onYolo()
                      }}
                    >
                      YOLO
                      <Kbd className="ml-1.5 h-4 text-[10px] bg-destructive-foreground/20 text-destructive-foreground">
                        {formatShortcutDisplay(
                          DEFAULT_KEYBINDINGS.approve_plan_yolo
                        )}
                      </Kbd>
                    </Button>
                  </div>
                )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={onArchive}>
            <Archive className="mr-2 h-4 w-4" />
            Archive Session
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Session
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
)
