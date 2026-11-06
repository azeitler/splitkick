import { useCallback, useMemo } from 'react'
import { Workflow } from 'lucide-react'
import { SidebarSectionRow } from '@/components/chat/SidebarSectionRow'
import { baseName, dirName, graphWhere } from '@/components/graphs/graph-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { openGraphView } from '@/lib/graph-view'
import { cn } from '@/lib/utils'
import { useGraphs } from '@/services/graphs'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { GraphSummary } from '@/types/graphs'
import { selectProjectGraphs, type ProjectGraphEntry } from './project-graphs'
import { SidebarGraphBadges } from './SidebarGraphsSection'
import {
  SIDEBAR_NESTED_ROW_SHAPE,
  SIDEBAR_ROW_SELECTED,
  SIDEBAR_SESSION_LIST,
  SIDEBAR_SESSION_ROW_PADDING,
  SIDEBAR_WORKTREE_SECTION_PADDING,
} from './sidebar-row-styles'

interface ProjectGraphsSectionProps {
  projectId: string
  /** Graph ids that the project's sessions serve (`collectServedGraphIds`). */
  servedGraphIds: ReadonlySet<string>
  /** `sidebar` is a collapsible tree row; `canvas` (project view, also on a
   *  phone) is an always-open block under Pinned, like `PinnedSessionsSection`. */
  variant?: 'sidebar' | 'canvas'
}

/**
 * The project's Graphs row in the sidebar tree, beside Pinned (#99): graphs
 * stored in the project, then graphs from elsewhere that one of its sessions
 * serves. Derived from the graph list and the sessions the sidebar already
 * loads, so it costs no extra request. Hidden when nothing is relevant.
 * The project canvas shows the same list (`variant="canvas"`), so a phone,
 * which has no sidebar, has it too.
 */
export function ProjectGraphsSection({
  projectId,
  servedGraphIds,
  variant = 'sidebar',
}: ProjectGraphsSectionProps) {
  const { data: graphs } = useGraphs()
  const expanded = useProjectsStore(state =>
    state.expandedGraphsProjectIds.has(projectId)
  )
  const activeGraphId = useUIStore(state => state.activeGraphId)
  const isMobile = useIsMobile()

  const entries = useMemo(
    () => selectProjectGraphs(graphs ?? [], projectId, servedGraphIds),
    [graphs, projectId, servedGraphIds]
  )

  const handleToggle = useCallback(() => {
    useProjectsStore.getState().toggleProjectGraphsExpanded(projectId)
  }, [projectId])

  const handleOpen = useCallback(
    (graphId: string) => {
      openGraphView(graphId)
      if (isMobile) useUIStore.getState().setLeftSidebarVisible(false)
    },
    [isMobile]
  )

  if (entries.length === 0) return null

  if (variant === 'canvas') {
    return (
      <div className="mb-3" data-testid="project-graphs-section">
        <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Workflow className="size-3" aria-hidden="true" />
          <span>Graphs</span>
          <span className="text-muted-foreground/60">{entries.length}</span>
        </div>
        {entries.map(entry => (
          <ProjectGraphRow
            key={entry.graph.id}
            entry={entry}
            variant="canvas"
            selected={entry.graph.id === activeGraphId}
            onOpen={handleOpen}
          />
        ))}
      </div>
    )
  }

  return (
    <div data-testid="project-graphs-section">
      <SidebarSectionRow
        icon={<Workflow className="size-2.5 shrink-0" aria-hidden="true" />}
        label="Graphs"
        count={entries.length}
        noun="graph"
        expanded={expanded}
        onToggle={handleToggle}
        className={SIDEBAR_WORKTREE_SECTION_PADDING}
        testId="project-graphs-toggle"
      />
      {expanded && (
        // The same guide line and offset as the Pinned list.
        <div
          className={cn('py-0.5', SIDEBAR_SESSION_LIST)}
          data-testid="project-graphs-list"
        >
          {entries.map(entry => (
            <ProjectGraphRow
              key={entry.graph.id}
              entry={entry}
              variant="sidebar"
              selected={entry.graph.id === activeGraphId}
              onOpen={handleOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectGraphRow({
  entry: { graph, served },
  variant,
  selected,
  onOpen,
}: {
  entry: ProjectGraphEntry
  variant: 'sidebar' | 'canvas'
  selected: boolean
  onOpen: (graphId: string) => void
}) {
  const type = graph.graphType.trim()
  // The row says only where a served graph comes from; the tooltip has the
  // type and the full location.
  const context = served ? `from ${servedFrom(graph)}` : type
  const tooltip = [
    graph.title,
    [type, served && `served from ${graphWhere(graph)}`]
      .filter(Boolean)
      .join(' · '),
  ]
    .filter(Boolean)
    .join(' — ')

  return (
    <button
      type="button"
      onClick={() => onOpen(graph.id)}
      aria-current={selected ? 'page' : undefined}
      title={tooltip}
      data-testid={`project-graph-row-${graph.id}`}
      data-served={served ? '' : undefined}
      className={cn(
        // A pinned session row's geometry: 6 px glyph at 48, label at 60.
        'flex items-center gap-1.5 text-left text-sm hover:bg-accent/50 hover:text-foreground',
        variant === 'sidebar'
          ? cn('py-1', SIDEBAR_NESTED_ROW_SHAPE, SIDEBAR_SESSION_ROW_PADDING)
          : 'w-full rounded px-2 py-1.5',
        selected
          ? variant === 'sidebar'
            ? cn(SIDEBAR_ROW_SELECTED, 'font-medium')
            : 'bg-primary/10 text-foreground'
          : 'text-muted-foreground'
      )}
    >
      {/* A square, not the session dot; hollow when the graph lives elsewhere. */}
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-[1px] border border-current',
          !served && 'bg-current'
        )}
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          variant === 'sidebar' && 'text-xs'
        )}
      >
        {graph.title}
      </span>
      {context && (
        <span
          className="min-w-0 max-w-[40%] shrink truncate text-[10px] text-muted-foreground/70"
          data-testid="project-graph-context"
        >
          {context}
        </span>
      )}
      <SidebarGraphBadges graph={graph} />
    </button>
  )
}

/** Short origin of a served graph: its project, its repo, or the instance. */
function servedFrom(graph: GraphSummary): string {
  if (graph.locationKind === 'folder') return 'instance'
  return graph.projectName ?? baseName(graph.repoRoot ?? dirName(graph.path))
}
