import { Pin, PinOff } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { getLabelTextColor } from '@/lib/label-colors'
import { cn } from '@/lib/utils'
import { closeOpenSessionContextMenus } from './SessionContextMenuItems'
import { statusConfig, type SessionCardData } from './session-card-utils'
import type { PinnedSessionRow } from './pinned-sessions'

export interface PinnedSessionEntryRow {
  row: PinnedSessionRow
  card: SessionCardData
}

interface PinnedSessionsSectionProps {
  rows: PinnedSessionEntryRow[]
  /** `canvas` sits above the worktree sections; `sidebar` sits under the project row. */
  variant: 'canvas' | 'sidebar'
  onOpen: (row: PinnedSessionRow) => void
  onUnpin: (sessionId: string) => void
}

/**
 * Sessions the user pinned to the project root, shown on the project canvas and
 * in the sidebar tree. Rows are mouse and context-menu only — they deliberately
 * stay out of the canvas keyboard navigation, which indexes worktree sections.
 */
export function PinnedSessionsSection({
  rows,
  variant,
  onOpen,
  onUnpin,
}: PinnedSessionsSectionProps) {
  if (rows.length === 0) return null

  const isSidebar = variant === 'sidebar'

  return (
    <div
      // The sidebar host already supplies the tree indent and left border, so
      // this variant only adds the separator under the block.
      className={cn(isSidebar ? 'mb-1 border-b border-border/40 pb-1' : 'mb-3')}
      data-testid="pinned-sessions-section"
    >
      <div
        className={cn(
          'flex items-center gap-1.5 uppercase tracking-wide text-muted-foreground',
          isSidebar ? 'pl-3 py-0.5 text-[10px]' : 'px-1 pb-1 text-[11px]'
        )}
      >
        <Pin className={isSidebar ? 'size-2.5 shrink-0' : 'size-3 shrink-0'} />
        <span>Pinned</span>
        <span className="text-muted-foreground/60">{rows.length}</span>
      </div>

      {rows.map(({ row, card }) => {
        const config = statusConfig[card.status]
        return (
          <ContextMenu key={row.sessionId}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                onClick={() => onOpen(row)}
                onContextMenuCapture={closeOpenSessionContextMenus}
                title={`${row.session.name} — ${row.worktreeName}`}
                className={cn(
                  'flex w-full items-center gap-1.5 truncate text-left text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  isSidebar
                    ? 'pl-5 py-1 text-sm'
                    : 'rounded px-2 py-1.5 text-sm'
                )}
              >
                <StatusIndicator
                  status={config.indicatorStatus}
                  variant={config.indicatorVariant}
                  shape={config.indicatorShape}
                  label={config.label}
                  className="h-1.5 w-1.5 shrink-0"
                />
                <span className="truncate">{row.session.name}</span>
                <span className="shrink-0 truncate text-[10px] text-muted-foreground/70">
                  {row.worktreeName}
                </span>
                {card.label && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                    style={{
                      backgroundColor: card.label.color,
                      color: getLabelTextColor(card.label.color),
                    }}
                  >
                    {card.label.name}
                  </span>
                )}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuItem onSelect={() => onUnpin(row.sessionId)}>
                <PinOff className="mr-2 h-4 w-4" />
                Unpin from Project
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}
