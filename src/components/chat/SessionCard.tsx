import { forwardRef } from 'react'
import {
  Archive,
  Clock,
  FileText,
  Shield,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
              'group flex w-[300px] h-[180px] flex-col gap-3 overflow-hidden rounded-lg border p-4 transition-colors text-left cursor-pointer',
              'hover:border-foreground/20 hover:bg-muted/50',
              card.isWaiting && !isSelected && 'border-yellow-500/50',
              isSelected &&
                'border-primary bg-primary/5 hover:border-primary hover:bg-primary/10'
            )}
          >
            {/* Top row: type label + execution mode + plan button */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                {config.icon}
                <span>Session</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {card.executionMode}
                </span>
                {/* Plan button - icon only, top right */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative z-10 h-5 w-5"
                      disabled={!card.planFilePath && !card.planContent}
                      onClick={e => {
                        e.stopPropagation()
                        onPlanView()
                      }}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {card.planFilePath || card.planContent
                      ? 'View plan'
                      : 'No plan available'}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Session name */}
            <div className="text-sm font-medium leading-snug line-clamp-2">
              {card.session.name}
            </div>

            {/* Bottom section: status badge + actions */}
            <div className="flex flex-col gap-2">
              {/* Status row */}
              <div className="flex items-center gap-1.5">
                {/* Status badge */}
                <div
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wide',
                    config.bgClass,
                    config.textClass
                  )}
                >
                  <span>{config.label}</span>
                </div>

                {/* Waiting indicator for questions */}
                {card.hasQuestion && (
                  <span className="flex items-center h-6 px-2 text-[10px] uppercase tracking-wide border border-yellow-500/50 text-yellow-600 dark:text-yellow-400 rounded">
                    <Clock className="mr-1 h-3 w-3" />
                    Question
                  </span>
                )}

                {/* Permission denials indicator */}
                {card.hasPermissionDenials && (
                  <span className="flex items-center h-6 px-2 text-[10px] uppercase tracking-wide border border-yellow-500/50 text-yellow-600 dark:text-yellow-400 rounded">
                    <Shield className="mr-1 h-3 w-3" />
                    {card.permissionDenialCount} blocked
                  </span>
                )}
              </div>

              {/* Actions row - Approve buttons for ExitPlanMode */}
              {card.hasExitPlanMode && !card.hasQuestion && onApprove && onYolo && (
                <div className="relative z-10 flex items-center gap-1.5">
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={e => {
                      e.stopPropagation()
                      onApprove()
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={e => {
                      e.stopPropagation()
                      onYolo()
                    }}
                  >
                    YOLO
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
