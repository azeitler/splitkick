import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import type { ExecutionMode } from '@/types/chat'

export interface SessionCardProps {
  sessionId: string
  sessionName: string
  worktreeName: string
  column: 'idle' | 'active' | 'waiting' | 'reviewing'
  executionMode?: ExecutionMode
  isReviewing?: boolean
  onClick: () => void
  disabled?: boolean
}

export function SessionCard({
  sessionId,
  sessionName,
  worktreeName,
  column,
  executionMode,
  isReviewing,
  onClick,
  disabled = false,
}: SessionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sessionId,
    disabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1, // Hide original - DragOverlay shows the preview
    zIndex: isDragging ? 10 : 0,
  }

  // Determine badge to show based on state
  // Determine badge to show based on column state
  const getBadge = () => {
    if (column === 'waiting') {
      return (
        <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          waiting
        </span>
      )
    }

    if (column === 'active') {
      if (executionMode === 'yolo') {
        return (
          <span className="shrink-0 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
            yoloing
          </span>
        )
      }
      return (
        <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {executionMode === 'plan' ? 'planning' : 'vibing'}
        </span>
      )
    }

    if (column === 'reviewing' || isReviewing) {
      return (
        <span className="shrink-0 rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
          review
        </span>
      )
    }

    return null
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md border bg-card p-2 shadow-sm transition-colors hover:bg-accent/50',
        isDragging && 'cursor-grabbing shadow-lg',
        !disabled && !isDragging && 'cursor-grab',
        disabled && 'cursor-pointer'
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{sessionName}</span>
        <span className="truncate text-xs text-muted-foreground">
          {worktreeName}
        </span>
      </div>
      {getBadge()}
    </div>
  )
}
