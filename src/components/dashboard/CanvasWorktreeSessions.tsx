import { ChevronRight } from 'lucide-react'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from '@/components/chat/SessionShortcutRows'
import {
  statusConfig,
  type SessionCardData,
} from '@/components/chat/session-card-utils'
import { getSessionActivityTimestamp } from '@/components/projects/worktree-sort-utils'
import { cn } from '@/lib/utils'
import type { Worktree } from '@/types/projects'

/**
 * Phone-only chevron beside a canvas worktree row. A phone has no sidebar, so
 * this is the one place that lists a worktree's sessions. It sits beside the
 * row, not inside it: the row is itself a button that opens the worktree.
 */
export function CanvasWorktreeExpandButton({
  worktree,
  expanded,
  onToggle,
}: {
  worktree: Worktree
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-muted/50"
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Hide' : 'Show'} sessions of ${worktree.name}`}
      data-testid={`worktree-expand-${worktree.id}`}
      onClick={onToggle}
    >
      <ChevronRight
        className={cn('size-4 transition-transform', expanded && 'rotate-90')}
      />
    </button>
  )
}

/** The sessions of one worktree, in the canvas' status-group order. */
export function CanvasWorktreeSessions({
  worktree,
  projectId,
  cards,
  onOpen,
}: {
  worktree: Worktree
  projectId: string
  cards: SessionCardData[]
  onOpen: (sessionId: string) => void
}) {
  const shortcuts: SessionShortcut[] = cards.map(card => ({
    sessionId: card.session.id,
    projectId,
    worktreeId: worktree.id,
    worktreePath: worktree.path,
    session: card.session,
    card,
    // Every row is in this worktree, so line 2 names the status instead.
    context: statusConfig[card.status].label,
    activityAt: getSessionActivityTimestamp(card.session),
  }))

  return (
    <div
      className="mb-2 ml-4 border-l border-border/60 pl-2 [&>button]:min-h-11"
      data-testid={`worktree-sessions-${worktree.id}`}
    >
      {shortcuts.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">No sessions</p>
      ) : (
        <SessionShortcutRows
          shortcuts={shortcuts}
          variant="canvas"
          layout="stacked"
          onOpen={shortcut => onOpen(shortcut.sessionId)}
        />
      )}
    </div>
  )
}
