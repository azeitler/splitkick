import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  FileText,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  Inbox,
  ListTree,
  Network,
  Play,
  Workflow,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ToolbarContent,
  useHasWindowToolbar,
} from '@/components/toolbar/toolbar-slots'
import { ToolbarPaletteSearch } from '@/components/toolbar/ToolbarSearchField'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { LocalPathRootContext } from '@/lib/chat-links'
import { getDirname } from '@/lib/path-utils'
import { cn } from '@/lib/utils'
import {
  useCommitGraph,
  useGraph,
  useGraphChanges,
  useRemoveGraph,
  useUpdateGraph,
} from '@/services/graphs'
import { useUIStore } from '@/store/ui-store'
import type { GraphSummary } from '@/types/graphs'
import { GraphDependencies } from './GraphDependencies'
import { GraphNodeDetail } from './GraphNodeDetail'
import { GraphOutline } from './GraphOutline'
import { GraphReview } from './GraphReview'
import type { GraphTabProps } from './graph-tab'
import { graphRelativePath, graphWhere, unseenNodeIds } from './graph-utils'

export type GraphTab = 'outline' | 'dependencies' | 'review'

/**
 * The tabs of a graph. Each takes `GraphTabProps`; Dependencies and Review
 * are placeholders in their own files until they are built.
 */
const TABS: {
  id: GraphTab
  label: string
  icon: typeof ListTree
  Component: (props: GraphTabProps) => ReactNode
}[] = [
  { id: 'outline', label: 'Outline', icon: ListTree, Component: GraphOutline },
  {
    id: 'dependencies',
    label: 'Dependencies',
    icon: Network,
    Component: GraphDependencies,
  },
  { id: 'review', label: 'Review', icon: Inbox, Component: GraphReview },
]

/**
 * A graph in the main area (`ui-store.activeGraphId`). Header with title,
 * type and where the file is; tabs; the node detail panel on the right.
 */
export function GraphView({ graphId }: { graphId: string }) {
  const { data: detail, error, isLoading } = useGraph(graphId)
  const { data: changes } = useGraphChanges(graphId)
  const hasToolbar = useHasWindowToolbar()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<GraphTab>('outline')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const unseen = useMemo(() => unseenNodeIds(changes), [changes])

  // `openGraphView(id, nodeId)` asks for one node: select it once.
  const focusNodeId = useUIStore(state => state.graphFocusNodeId)
  useEffect(() => {
    if (!focusNodeId) return
    setSelectedNodeId(focusNodeId)
    useUIStore.getState().setGraphFocusNodeId(null)
  }, [focusNodeId])

  const title = detail?.summary.title ?? 'Graph'
  const toolbar = hasToolbar ? (
    <ToolbarContent
      title="Graphs"
      subtitle={title}
      search={<ToolbarPaletteSearch />}
    />
  ) : null

  // A failed refetch keeps the last good data: show the error instead, or a
  // missing or broken file would still look editable.
  if (!detail || error) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
        data-testid="graph-view"
      >
        {toolbar}
        {isMobile && <MobileBackButton />}
        <p data-testid="graph-load-error" className="max-w-xl text-center">
          {!error && isLoading
            ? 'Loading graph…'
            : `Could not load the graph. ${error ?? ''}`}
        </p>
        {(error || !isLoading) && <RemoveGraphButton graphId={graphId} />}
      </div>
    )
  }

  const ActiveTab = TABS.find(t => t.id === tab)?.Component ?? GraphOutline
  const tabProps: GraphTabProps = {
    graphId,
    detail,
    changes,
    unseenNodeIds: unseen,
    selectedNodeId,
    onSelectNode: setSelectedNodeId,
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col font-sans"
      data-testid="graph-view"
    >
      {toolbar}
      {isMobile && <MobileBackButton />}
      <GraphHeader summary={detail.summary} />
      <div
        role="tablist"
        aria-label="Graph views"
        className="flex shrink-0 items-center gap-1 border-b px-6"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-testid={`graph-tab-${id}`}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
              tab === id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
            {id === 'review' && detail.summary.openRequests > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-medium text-white">
                {detail.summary.openRequests}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Relative paths in graph text resolve as they do in chat. */}
        <LocalPathRootContext.Provider
          value={detail.summary.repoRoot ?? getDirname(detail.summary.path)}
        >
          <div className="min-w-0 flex-1 overflow-y-auto" role="tabpanel">
            <ActiveTab {...tabProps} />
          </div>
          {selectedNodeId && (
            <GraphNodeDetail
              key={selectedNodeId}
              graphId={graphId}
              detail={detail}
              nodeId={selectedNodeId}
              changes={changes}
              onClose={() => setSelectedNodeId(null)}
              onSelectNode={setSelectedNodeId}
              onOpenReview={() => setTab('review')}
            />
          )}
        </LocalPathRootContext.Provider>
      </div>
    </div>
  )
}

function Chip({
  children,
  className,
  title,
  testId,
}: {
  children: ReactNode
  className?: string
  title?: string
  testId?: string
}) {
  return (
    <span
      title={title}
      data-testid={testId}
      className={cn(
        'inline-flex h-6 max-w-72 items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground',
        className
      )}
    >
      {children}
    </span>
  )
}

function GraphHeader({ summary }: { summary: GraphSummary }) {
  const commitGraph = useCommitGraph()
  const handleCommit = useCallback(async () => {
    try {
      const sha = await commitGraph.mutateAsync({ graphId: summary.id })
      toast.success(`Committed ${summary.title}`, {
        description: sha.slice(0, 7),
      })
    } catch {
      // The mutation already toasted.
    }
  }, [commitGraph, summary.id, summary.title])

  return (
    <header className="flex shrink-0 flex-col gap-2 px-6 pt-5 pb-3">
      {/* Wraps on a phone, so the buttons never squeeze the title away. */}
      <div className="flex flex-wrap items-center gap-2">
        <Workflow className="size-5 shrink-0" aria-hidden="true" />
        <GraphTitleField graphId={summary.id} title={summary.title} />
        <GraphTypeField graphId={summary.id} graphType={summary.graphType} />
        <span className="flex-1" />
        {summary.locationKind !== 'folder' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={commitGraph.isPending || summary.missing}
            onClick={handleCommit}
          >
            <GitCommitHorizontal className="size-4" aria-hidden="true" />
            Commit graph
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            useUIStore
              .getState()
              .setStartAgentSessionTarget({ serves: summary.id })
          }
        >
          <Play className="size-4" aria-hidden="true" />
          Start session…
        </Button>
        <RemoveGraphButton graphId={summary.id} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip title={summary.repoRoot ?? undefined}>
          <Folder className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{graphWhere(summary)}</span>
        </Chip>
        <Chip title={summary.path} className="font-mono">
          <FileText className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{graphRelativePath(summary)}</span>
        </Chip>
        {summary.branch && (
          <Chip
            testId="graph-branch-chip"
            className={cn(
              summary.offDefaultBranch && 'border-amber-500/60 text-amber-500'
            )}
            title={
              summary.offDefaultBranch
                ? `The checkout is not on ${summary.defaultBranch ?? 'the default branch'}`
                : undefined
            }
          >
            {summary.offDefaultBranch ? (
              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <GitBranch className="size-3 shrink-0" aria-hidden="true" />
            )}
            {summary.branch}
          </Chip>
        )}
        {summary.missing && (
          <Chip
            testId="graph-missing-chip"
            className="border-destructive/60 text-destructive"
          >
            <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
            file missing
          </Chip>
        )}
        {summary.error && (
          <Chip
            className="border-destructive/60 text-destructive"
            title={summary.error}
          >
            <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{summary.error}</span>
          </Chip>
        )}
      </div>
    </header>
  )
}

/** The graph title; click to edit, saved on blur or Enter. */
function GraphTitleField({
  graphId,
  title,
}: {
  graphId: string
  title: string
}) {
  const updateGraph = useUpdateGraph()
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    const trimmed = draft?.trim()
    setDraft(null)
    if (trimmed && trimmed !== title) {
      updateGraph.mutate({ graphId, title: trimmed })
    }
  }

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(title)}
        title="Rename graph"
        className="truncate rounded text-xl font-semibold hover:bg-accent/50"
        data-testid="graph-title"
      >
        {title}
      </button>
    )
  }
  return (
    <input
      autoFocus
      aria-label="Graph title"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      className="min-w-0 rounded bg-transparent text-xl font-semibold outline-none ring-1 ring-ring"
    />
  )
}

/** The graph type chip; click to edit, saved on blur or Enter. */
function GraphTypeField({
  graphId,
  graphType,
}: {
  graphId: string
  graphType: string
}) {
  const updateGraph = useUpdateGraph()
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    const trimmed = draft?.trim() ?? ''
    setDraft(null)
    if (trimmed !== graphType.trim()) {
      updateGraph.mutate({ graphId, graphType: trimmed })
    }
  }

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(graphType)}
        title="Change type"
        data-testid="graph-type"
        className="inline-flex h-6 max-w-72 items-center rounded-full border px-2 text-xs text-muted-foreground hover:bg-accent/50"
      >
        {graphType || 'no type'}
      </button>
    )
  }
  return (
    <input
      autoFocus
      aria-label="Graph type"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      className="h-6 w-32 rounded-full bg-transparent px-2 text-xs outline-none ring-1 ring-ring"
    />
  )
}

/** Phone: no sidebar or toolbar to leave the graph by. */
function MobileBackButton() {
  return (
    <div className="flex shrink-0 px-3 pt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => useUIStore.getState().setActiveGraphId(null)}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back
      </Button>
    </div>
  )
}

function RemoveGraphButton({ graphId }: { graphId: string }) {
  const removeGraph = useRemoveGraph()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={removeGraph.isPending}
      title="Remove from the list. The file stays where it is."
      onClick={() =>
        removeGraph.mutate(
          { graphId },
          {
            onSuccess: () => {
              useUIStore.getState().setActiveGraphId(null)
              toast.success('Graph removed from the list', {
                description: 'The file stays where it is.',
              })
            },
          }
        )
      }
    >
      <X className="size-4" aria-hidden="true" />
      Remove from list
    </Button>
  )
}
