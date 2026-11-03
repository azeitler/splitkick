import {
  Ban,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
  Loader2,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { NodeState } from '@/types/graphs'

/** Stored state as a glyph, the leading mark of an outline row. */
export function NodeStateGlyph({
  state,
  className,
}: {
  state: NodeState
  className?: string
}) {
  const shared = cn('size-4 shrink-0', className)
  switch (state) {
    case 'proposed':
      return (
        <CircleDashed
          className={cn(shared, 'text-muted-foreground')}
          aria-label="proposed"
        />
      )
    case 'committed':
      return (
        <Circle
          className={cn(shared, 'text-blue-500')}
          aria-label="committed"
        />
      )
    case 'done':
      return (
        <CircleCheck
          className={cn(shared, 'text-green-500')}
          aria-label="done"
        />
      )
    case 'dropped':
      return (
        <CircleX
          className={cn(shared, 'text-muted-foreground')}
          aria-label="dropped"
        />
      )
  }
}

const STATE_CHIP: Record<NodeState, string> = {
  proposed: 'border-dashed border-muted-foreground/50 text-muted-foreground',
  committed: 'border-blue-500/60 text-blue-500',
  done: 'border-green-500/60 text-green-500',
  dropped: 'border-muted-foreground/40 text-muted-foreground line-through',
}

/** Stored state as a chip (uppercase, as in the mockup). */
export function NodeStateChip({ state }: { state: NodeState }) {
  return (
    <span
      data-testid="node-state-chip"
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-wide',
        STATE_CHIP[state]
      )}
    >
      {state}
    </span>
  )
}

/** Derived: a session serving the node is running. */
export function ActiveBadge() {
  return (
    <span
      data-testid="node-active-badge"
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-orange-500/10 px-2 text-xs text-orange-500"
    >
      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      active
    </span>
  )
}

/** Derived: blocked by a relation or an open decision. */
export function BlockedBadge({ blockers }: { blockers: string[] }) {
  const badge = (
    <span
      data-testid="node-blocked-badge"
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2 text-xs text-red-500"
    >
      <Ban className="size-3" aria-hidden="true" />
      blocked
    </span>
  )
  if (blockers.length === 0) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5">
          {blockers.map(blocker => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

/** Derived: done part-of children over all (dropped excluded). */
export function ProgressBar({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
      data-testid="node-progress"
    >
      <span
        className="h-1 w-16 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <span
          className="block h-full rounded-full bg-green-500"
          style={{ width: `${percent}%` }}
        />
      </span>
      {done}/{total} done
    </span>
  )
}

/** Orange dot: the node changed since the user last looked. */
export function UnseenDot() {
  return (
    <span
      data-testid="node-unseen-dot"
      className="size-1.5 shrink-0 rounded-full bg-orange-500"
      aria-label="changed since you looked"
    />
  )
}

/** A cross-graph ref whose graph or node does not exist. */
export function NotFound() {
  return (
    <span
      data-testid="graph-ref-not-found"
      className="shrink-0 text-xs text-red-500"
    >
      not found
    </span>
  )
}
