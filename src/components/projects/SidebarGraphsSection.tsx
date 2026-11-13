import { useCallback, useState } from 'react'
import { AlertTriangle, Workflow } from 'lucide-react'
import { NewGraphDialog } from '@/components/graphs/NewGraphDialog'
import { graphSubtitle } from '@/components/graphs/graph-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { openGraphView } from '@/lib/graph-view'
import { cn } from '@/lib/utils'
import { useGraphs } from '@/services/graphs'
import { useUIStore } from '@/store/ui-store'
import type { GraphSummary } from '@/types/graphs'
import { SectionNewButton } from './SectionNewButton'
import { SidebarTabEmpty } from './SidebarTabEmpty'
import {
  SIDEBAR_PROJECT_ROW_PADDING,
  SIDEBAR_ROW_SELECTED,
  SIDEBAR_ROW_SHAPE,
} from './sidebar-row-styles'

/**
 * The sidebar's Graphs tab: every registered graph (graph layer, #79).
 *
 * "+ New" sits at the top of the tab, so it stays reachable with no graphs.
 * Orange count = requests waiting for the user, grey count = changes the user
 * has not seen.
 */
export function SidebarGraphsSection() {
  const activeGraphId = useUIStore(state => state.activeGraphId)
  const isMobile = useIsMobile()
  const { data: graphs = [] } = useGraphs()
  const [newOpen, setNewOpen] = useState(false)

  const handleOpen = useCallback(
    (graphId: string) => {
      openGraphView(graphId)
      if (isMobile) useUIStore.getState().setLeftSidebarVisible(false)
    },
    [isMobile]
  )

  return (
    <div data-testid="sidebar-graphs-section">
      <div className="flex items-center justify-end px-2 pt-1">
        <SectionNewButton label="New graph" onClick={() => setNewOpen(true)} />
      </div>
      {graphs.length === 0 ? (
        <SidebarTabEmpty
          icon={<Workflow />}
          title="No graphs yet"
          hint="Create one with New."
          testId="sidebar-graphs-empty"
        />
      ) : (
        <div className="py-0.5">
          {graphs.map(graph => (
            <SidebarGraphRow
              key={graph.id}
              graph={graph}
              selected={graph.id === activeGraphId}
              onOpen={handleOpen}
            />
          ))}
        </div>
      )}
      <NewGraphDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  )
}

function SidebarGraphRow({
  graph,
  selected,
  onOpen,
}: {
  graph: GraphSummary
  selected: boolean
  onOpen: (graphId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(graph.id)}
      aria-current={selected ? 'page' : undefined}
      data-testid={`sidebar-graph-row-${graph.id}`}
      className={cn(
        'group relative flex cursor-pointer items-start gap-1.5 text-left transition-colors duration-150',
        'py-1.5',
        SIDEBAR_ROW_SHAPE,
        SIDEBAR_PROJECT_ROW_PADDING,
        selected
          ? SIDEBAR_ROW_SELECTED
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <Workflow className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-sm',
            selected ? 'text-foreground' : 'text-foreground/90'
          )}
        >
          {graph.title}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {graphSubtitle(graph)}
        </span>
      </span>
      <SidebarGraphBadges graph={graph} className="mt-0.5" />
    </button>
  )
}

/**
 * A graph row's trailing badges: file warning, requests waiting for the user
 * (orange) and changes the user has not seen (grey). Shared with the project
 * Graphs section (#99).
 */
export function SidebarGraphBadges({
  graph,
  className,
}: {
  graph: GraphSummary
  className?: string
}) {
  const warning = graph.missing
    ? 'File missing'
    : graph.error
      ? graph.error
      : graph.offDefaultBranch
        ? `Checkout is on ${graph.branch ?? 'another branch'}, not ${graph.defaultBranch ?? 'the default branch'}`
        : null

  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {warning && (
        <span
          title={warning}
          aria-label={warning}
          data-testid="sidebar-graph-warning"
        >
          <AlertTriangle
            className="size-3.5 text-amber-500"
            aria-hidden="true"
          />
        </span>
      )}
      {graph.openRequests > 0 && (
        <span
          title={`${graph.openRequests} waiting for you`}
          data-testid="sidebar-graph-requests"
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-medium text-white"
        >
          {graph.openRequests}
        </span>
      )}
      {graph.unseenChanges > 0 && (
        <span
          title={`${graph.unseenChanges} changes you have not seen`}
          data-testid="sidebar-graph-unseen"
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground"
        >
          {graph.unseenChanges}
        </span>
      )}
    </span>
  )
}
