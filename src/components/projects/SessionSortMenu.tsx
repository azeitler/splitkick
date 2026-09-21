import { createElement } from 'react'
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowDownZA,
  ArrowUpNarrowWide,
  type LucideIcon,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/store/projects-store'
import type { SessionSortMode, SortDirection } from '@/types/projects'
import { defaultSessionSortDirection } from './worktree-sort-utils'

const MODES: { mode: SessionSortMode; label: string }[] = [
  { mode: 'default', label: 'Default' },
  { mode: 'last_activity', label: 'Last activity' },
  { mode: 'title', label: 'Title' },
]

/** Direction wording per mode. "Ascending" says nothing about which end is new. */
const DIRECTION_LABELS: Record<
  Exclude<SessionSortMode, 'default'>,
  Record<SortDirection, string>
> = {
  last_activity: { desc: 'Newest first', asc: 'Oldest first' },
  title: { asc: 'A → Z', desc: 'Z → A' },
}

function sortIcon(mode: SessionSortMode, direction: SortDirection): LucideIcon {
  if (mode === 'title') return direction === 'asc' ? ArrowDownAZ : ArrowDownZA
  if (mode === 'last_activity' && direction === 'asc') return ArrowUpNarrowWide
  return ArrowDownWideNarrow
}

/** The mode's natural direction first: newest first, A → Z. */
function directionOrder(
  mode: Exclude<SessionSortMode, 'default'>
): SortDirection[] {
  return defaultSessionSortDirection(mode) === 'desc'
    ? ['desc', 'asc']
    : ['asc', 'desc']
}

/** What the trigger's tooltip and accessible name say about the active order. */
export function describeSessionSort(
  mode: SessionSortMode,
  direction: SortDirection
): string {
  if (mode === 'default') return 'Sort sessions'
  const label = MODES.find(item => item.mode === mode)?.label ?? mode
  return `Sort sessions: ${label}, ${DIRECTION_LABELS[mode][direction]}`
}

/**
 * The per-project sort control on the sidebar project row.
 *
 * It orders the sessions inside each workspace's status groups; the workspaces
 * themselves and the pinned block keep their own order. Picking the mode that
 * is already active flips its direction, and the direction is also offered on
 * its own below the modes so the flip is discoverable.
 */
export function SessionSortMenu({ projectId }: { projectId: string }) {
  const mode = useProjectsStore(
    state =>
      state.projectCanvasSettings[projectId]?.sessionSortMode ?? 'default'
  )
  const storedDirection = useProjectsStore(
    state => state.projectCanvasSettings[projectId]?.sessionSortDirection
  )
  const direction = storedDirection ?? defaultSessionSortDirection(mode)
  const isActive = mode !== 'default'
  const description = describeSessionSort(mode, direction)

  const setSort = (next: SessionSortMode, nextDirection: SortDirection) =>
    useProjectsStore
      .getState()
      .setProjectSessionSort(projectId, next, nextDirection)

  const handleModeSelect = (next: SessionSortMode) => {
    if (next === mode && next !== 'default') {
      setSort(next, direction === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(next, defaultSessionSortDirection(next))
    }
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              // The row itself selects and expands the project on click.
              onClick={e => e.stopPropagation()}
              aria-label={description}
              data-testid={`project-session-sort-${projectId}`}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent-foreground/10 hover:opacity-100',
                // A non-default order must never be invisible.
                isActive ? 'text-foreground opacity-100' : 'opacity-50'
              )}
            >
              {/* createElement: a capitalised local would read as a component
                  declared during render. */}
              {createElement(sortIcon(mode, direction), {
                className: 'size-3.5',
              })}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-44"
        // Menu events bubble through the portal to the project row.
        onClick={e => e.stopPropagation()}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Sort sessions
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode}>
          {MODES.map(item => (
            <DropdownMenuRadioItem
              key={item.mode}
              value={item.mode}
              onSelect={() => handleModeSelect(item.mode)}
            >
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {isActive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={direction}>
              {directionOrder(mode).map(value => (
                <DropdownMenuRadioItem
                  key={value}
                  value={value}
                  onSelect={() => setSort(mode, value)}
                >
                  {DIRECTION_LABELS[mode][value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
