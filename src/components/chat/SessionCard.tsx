import { forwardRef, useCallback } from 'react'
import {
  Archive,
  Eye,
  EyeOff,
  FileText,
  Pencil,
  Shield,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getLabelTextColor } from '@/lib/label-colors'
import { toast } from 'sonner'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { formatShortcutDisplay, DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  getResumeCommand,
  type SessionCardData,
  statusConfig,
} from './session-card-utils'

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
  onClearContextApprove?: () => void
  onClearContextBuildApprove?: () => void
  onWorktreeBuildApprove?: () => void
  onWorktreeYoloApprove?: () => void
  onToggleLabel?: () => void
  onToggleReview?: () => void
  onRename?: (sessionId: string, newName: string) => void
  isRenaming?: boolean
  renameValue?: string
  onRenameValueChange?: (value: string) => void
  onRenameStart?: (sessionId: string, currentName: string) => void
  onRenameSubmit?: (sessionId: string) => void
  onRenameCancel?: () => void
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
      onClearContextApprove,
      onClearContextBuildApprove,
      onWorktreeBuildApprove,
      onWorktreeYoloApprove,
      onToggleLabel,
      onToggleReview,
      isRenaming,
      renameValue,
      onRenameValueChange,
      onRenameStart,
      onRenameSubmit,
      onRenameCancel,
    },
    ref
  ) {
    const config = statusConfig[card.status]
    const isRunning = card.status === 'planning' || card.status === 'vibing' || card.status === 'yoloing'
    const resumeCommand = getResumeCommand(card.session)
    const isMobile = useIsMobile()
    const hasRecap = card.hasRecap
    const hasPlan = !!(card.planFilePath || card.planContent)
    const renameInputRef = useCallback((node: HTMLInputElement | null) => {
      if (node) {
        node.focus()
        node.select()
      }
    }, [])

    const handleRenameKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onRenameSubmit?.(card.session.id)
        } else if (e.key === 'Escape') {
          onRenameCancel?.()
        }
      },
      [onRenameSubmit, onRenameCancel, card.session.id]
    )

    return (
      <div
        className={cn(
          isRunning && 'card-border-spin',
          isRunning && card.status === 'yoloing' && 'card-border-spin--destructive',
        )}
      >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={ref}
            role="button"
            tabIndex={-1}
            onClick={onSelect}
            onDoubleClick={() =>
              onRenameStart?.(card.session.id, card.session.name)
            }
            className={cn(
              'group flex w-full sm:w-[260px] flex-col rounded-md overflow-hidden bg-muted/30 border transition-colors text-left cursor-pointer scroll-mt-28 scroll-mb-20',
              'hover:border-foreground/20 hover:bg-muted/50',
              isSelected &&
                'border-primary/50 bg-primary/5 hover:border-primary/50 hover:bg-primary/10 opacity-100',
              isRunning && 'relative z-[1] border-transparent bg-background',
              card.status === 'idle'
                ? 'gap-1.5 p-2.5'
                : 'gap-3 p-4 min-h-[132px]'
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
                {card.label ? (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{
                      backgroundColor: card.label.color,
                      color: getLabelTextColor(card.label.color),
                    }}
                  >
                    {card.label.name}
                  </span>
                ) : (
                  <span>Session</span>
                )}
              </div>
              {!isMobile && (
                <div className="flex items-center gap-1.5">
                {/* Recap button - only shown when recap exists */}
                {hasRecap && (
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
                {hasPlan && (
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
              )}
            </div>

            {/* Session name */}
            <div
              className={cn(
                'text-sm font-medium leading-snug line-clamp-2',
                card.status !== 'idle' && 'min-h-[2.75em]'
              )}
            >
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue ?? ''}
                  onChange={e => onRenameValueChange?.(e.target.value)}
                  onBlur={() => onRenameSubmit?.(card.session.id)}
                  onKeyDown={handleRenameKeyDown}
                  onClick={e => e.stopPropagation()}
                  onDoubleClick={e => e.stopPropagation()}
                  className="w-full min-w-0 bg-transparent text-sm font-medium outline-none ring-1 ring-ring rounded px-1"
                />
              ) : (
                card.session.name
              )}
            </div>

            {/* Bottom section: status badge + actions */}
            <div className="flex flex-col gap-2">
              {/* Status row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {card.hasPermissionDenials && (
                  <span className="flex items-center h-6 px-2 text-[10px] uppercase tracking-wide border border-yellow-500/50 text-yellow-600 dark:text-yellow-400 rounded">
                    <Shield className="mr-1 h-3 w-3" />
                    {card.permissionDenialCount} blocked
                  </span>
                )}
              </div>

              {/* Actions row - Approve + Auto buttons */}
              {card.hasExitPlanMode &&
                !card.hasQuestion &&
                card.session.backend !== 'codex' &&
                onApprove &&
                onYolo && (
                  <div className="relative z-10 flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          className="h-6 px-2 text-xs rounded"
                          disabled={card.isSending}
                          onClick={e => {
                            e.stopPropagation()
                            onApprove()
                          }}
                        >
                          Approve
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Approve plan ({formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan)})
                      </TooltipContent>
                    </Tooltip>
                    <div className="inline-flex">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            className="h-6 px-2 text-xs rounded-r-none border-r-0"
                            disabled={card.isSending}
                            onClick={e => {
                              e.stopPropagation()
                              onYolo()
                            }}
                          >
                            YOLO
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Approve with yolo mode ({formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan_yolo)})
                        </TooltipContent>
                      </Tooltip>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            className="h-6 px-1 text-xs rounded-l-none border-l border-l-border"
                            disabled={card.isSending}
                            onClick={e => e.stopPropagation()}
                          >
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {onClearContextBuildApprove && (
                            <DropdownMenuItem onClick={() => onClearContextBuildApprove()}>
                              New Session
                              <DropdownMenuShortcut>
                                {formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan_clear_context_build)}
                              </DropdownMenuShortcut>
                            </DropdownMenuItem>
                          )}
                          {onClearContextApprove && (
                            <DropdownMenuItem onClick={() => onClearContextApprove()}>
                              New Session (YOLO)
                              <DropdownMenuShortcut>
                                {formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan_clear_context)}
                              </DropdownMenuShortcut>
                            </DropdownMenuItem>
                          )}
                          {onWorktreeBuildApprove && (
                            <DropdownMenuItem onClick={() => onWorktreeBuildApprove()}>
                              New Worktree
                              <DropdownMenuShortcut>
                                {formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan_worktree_build)}
                              </DropdownMenuShortcut>
                            </DropdownMenuItem>
                          )}
                          {onWorktreeYoloApprove && (
                            <DropdownMenuItem onClick={() => onWorktreeYoloApprove()}>
                              New Worktree (YOLO)
                              <DropdownMenuShortcut>
                                {formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan_worktree_yolo)}
                              </DropdownMenuShortcut>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          {onRenameStart && (
            <ContextMenuItem
              onSelect={() =>
                onRenameStart(card.session.id, card.session.name)
              }
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </ContextMenuItem>
          )}
          {onToggleLabel && (
            <ContextMenuItem onSelect={onToggleLabel}>
              <Tag className="mr-2 h-4 w-4" />
              {card.label ? 'Remove Label' : 'Add Label'}
            </ContextMenuItem>
          )}
          {onToggleReview && (
            <ContextMenuItem onSelect={onToggleReview}>
              {card.status === 'review' ? (
                <>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Mark as Idle
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  Mark for Review
                </>
              )}
            </ContextMenuItem>
          )}
          {resumeCommand && (
            <ContextMenuItem
              onSelect={() => {
                void navigator.clipboard
                  .writeText(resumeCommand)
                  .then(() => toast.success('Resume command copied'))
                  .catch(() => toast.error('Failed to copy resume command'))
              }}
            >
              <Terminal className="mr-2 h-4 w-4" />
              Copy Resume Command
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!hasRecap}
            onSelect={onRecapView}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Recap
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasPlan}
            onSelect={onPlanView}
          >
            <FileText className="mr-2 h-4 w-4" />
            Plan
          </ContextMenuItem>
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
      </div>
    )
  }
)

SessionCard.displayName = 'SessionCard'
