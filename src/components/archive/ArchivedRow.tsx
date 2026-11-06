import { createElement, memo } from 'react'
import {
  ExternalLink,
  GitBranch,
  Link2,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getBackendIcon, getBackendLabel } from '@/components/ui/backend-label'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import {
  ARCHIVE_REASON_LABELS,
  formatArchiveDate,
  type ArchivedItem,
} from './archived-items'

export interface ArchivedRowActions {
  onToggleSelect: (item: ArchivedItem) => void
  onFocus: (item: ArchivedItem) => void
  onRestore: (item: ArchivedItem) => void
  onRestoreAndOpen: (item: ArchivedItem) => void
  onCopyLink: (item: ArchivedItem) => void
  onDelete: (item: ArchivedItem) => void
}

interface ArchivedRowProps extends ArchivedRowActions {
  item: ArchivedItem
  selected: boolean
  /** The keyboard cursor sits on this row */
  active: boolean
  disabled: boolean
  /** Message text that matched the search, shown instead of the preview */
  snippet?: string
}

/** One archived worktree or session. */
export const ArchivedRow = memo(function ArchivedRow({
  item,
  selected,
  active,
  disabled,
  snippet,
  onToggleSelect,
  onFocus,
  onRestore,
  onRestoreAndOpen,
  onCopyLink,
  onDelete,
}: ArchivedRowProps) {
  const Icon = item.kind === 'worktree' ? GitBranch : MessageSquare
  const where =
    item.kind === 'worktree'
      ? item.projectName
      : `${item.projectName} › ${item.worktreeName}`
  const preview = item.kind === 'session' ? (snippet ?? item.preview) : null

  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid="archived-row"
      data-key={item.key}
      data-active={active || undefined}
      tabIndex={active ? 0 : -1}
      onFocus={() => onFocus(item)}
      className={cn(
        'group flex items-start gap-3 rounded-md px-3 py-2 outline-none transition-colors',
        'hover:bg-accent/50 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50',
        selected && 'bg-primary/5'
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggleSelect(item)}
        aria-label={`Select ${item.name}`}
        className="mt-1"
      />
      <div
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          item.kind === 'worktree'
            ? 'bg-blue-500/10 text-blue-500'
            : 'bg-orange-500/10 text-orange-500'
        )}
        aria-label={item.kind === 'worktree' ? 'Worktree' : 'Session'}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="truncate">{where}</span>
          {item.kind === 'worktree' && (
            <span className="truncate">{item.branch}</span>
          )}
          {item.kind === 'session' && item.backend && (
            <span className="inline-flex items-center gap-1">
              {createElement(getBackendIcon(item.backend), {
                className: 'h-3 w-3',
              })}
              {getBackendLabel(item.backend)}
            </span>
          )}
          {item.kind === 'session' && (
            <span>
              {item.messageCount} message{item.messageCount === 1 ? '' : 's'}
            </span>
          )}
          {item.reason && (
            <span className="rounded-sm border px-1.5 text-[10px] leading-4">
              {ARCHIVE_REASON_LABELS[item.reason]}
            </span>
          )}
          {item.archivedAt > 0 && (
            <span className="whitespace-nowrap">
              Archived {formatRelativeTime(item.archivedAt)} (
              {formatArchiveDate(item.archivedAt)})
            </span>
          )}
        </div>
        {preview && (
          <div
            className="truncate text-xs text-muted-foreground/80"
            title={preview}
          >
            {preview}
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 transition-opacity',
          '[@media(pointer:fine)]:opacity-0 [@media(pointer:fine)]:group-hover:opacity-100 [@media(pointer:fine)]:group-focus-within:opacity-100'
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRestoreAndOpen(item)}
          disabled={disabled}
          aria-label={`Restore and open ${item.name}`}
        >
          <ExternalLink className="h-4 w-4" />
          <span className="hidden sm:inline">Restore & open</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={disabled}
              aria-label={`More actions for ${item.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onRestore(item)}>
              <RotateCcw className="h-4 w-4" />
              Restore
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCopyLink(item)}>
              <Link2 className="h-4 w-4" />
              Copy Splitkick link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(item)}
            >
              <Trash2 className="h-4 w-4" />
              Delete permanently…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
})
