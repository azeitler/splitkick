import { useCallback, useState } from 'react'
import { AlertTriangle, Workflow } from 'lucide-react'
import { NewGraphDialog } from '@/components/graphs/NewGraphDialog'
import { graphSubtitle } from '@/components/graphs/graph-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { openGraphView } from '@/lib/graph-view'
import { cn } from '@/lib/utils'
import { useGraphs } from '@/services/graphs'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { GraphSummary } from '@/types/graphs'
import { SectionNewButton } from './SectionNewButton'
import {
  SIDEBAR_NESTED_ROW_SHAPE,
  SIDEBAR_ROW_SELECTED,
  SIDEBAR_SECTION_HEADER_PADDING,
  SIDEBAR_WORKTREE_LIST,
  SIDEBAR_WORKTREE_ROW_PADDING,
} from './sidebar-row-styles'
import { SidebarStickySectionHeader } from './SidebarStickySectionHeader'

/**
 * Registered graphs, between Starred and Folders (graph layer, #79).
 *
 * Unlike Starred, the header always shows so "+ New" stays reachable; with no
 * graphs there are simply no rows under it. Orange count = requests waiting
 * for the user, grey count = changes the user has not seen.
 */
export function SidebarGraphsSection() {
  const collapsed = useProjectsStore(state => state.graphsSectionCollapsed)
  const activeGraphId = useUIStore(state => state.activeGraphId)
  const isMobile = useIsMobile()
  const { data: graphs = [] } = useGraphs()
  const [newOpen, setNewOpen] = useState(false)

  const handleToggle = useCallback(() => {
    useProjectsStore.getState().toggleGraphsSectionCollapsed()
  }, [])

  const handleOpen = useCallback(
    (graphId: string) => {
      openGraphView(graphId)
      if (isMobile) useUIStore.getState().setLeftSidebarVisible(false)
    },
    [isMobile]
  )

  return (
    // `contents`: the header's containing block is the whole scroller, so it
    // stays stuck in its slot after you scroll past the section.
    <div
      data-testid="sidebar-graphs-section"
      data-sidebar-graphs=""
      className="contents"
    >
      <SidebarStickySectionHeader
        top="var(--sb-graphs-top)"
        icon={<Workflow className="size-3.5 shrink-0" aria-hidden="true" />}
        label="Graphs"
        count={graphs.length}
        noun="graph"
        expanded={!collapsed}
        onToggle={handleToggle}
        className={SIDEBAR_SECTION_HEADER_PADDING}
        testId="sidebar-graphs-toggle"
        actions={
          <SectionNewButton
            label="New graph"
            onClick={() => setNewOpen(true)}
          />
        }
      />
      {!collapsed && graphs.length > 0 && (
        <div className={cn(SIDEBAR_WORKTREE_LIST, 'py-0.5')}>
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
  const warning = graph.missing
    ? 'File missing'
    : graph.error
      ? graph.error
      : graph.offDefaultBranch
        ? `Checkout is on ${graph.branch ?? 'another branch'}, not ${graph.defaultBranch ?? 'the default branch'}`
        : null

  return (
    <button
      type="button"
      onClick={() => onOpen(graph.id)}
      aria-current={selected ? 'page' : undefined}
      data-testid={`sidebar-graph-row-${graph.id}`}
      className={cn(
        'group relative flex cursor-pointer items-start gap-1.5 py-1 text-left transition-colors duration-150',
        SIDEBAR_NESTED_ROW_SHAPE,
        SIDEBAR_WORKTREE_ROW_PADDING,
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
      <span className="mt-0.5 flex shrink-0 items-center gap-1">
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
    </button>
  )
}
