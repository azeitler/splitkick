import { useCallback, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import { useCreateGraphNode } from '@/services/graphs'
import type { GraphDetail, GraphNode } from '@/types/graphs'
import {
  ActiveBadge,
  BlockedBadge,
  NodeStateChip,
  NodeStateGlyph,
  NotFound,
  ProgressBar,
  UnseenDot,
} from './graph-badges'
import {
  buildOutline,
  issueNumber,
  resolveRef,
  type OutlineItem,
} from './graph-utils'
import type { GraphTabProps } from './graph-tab'

/**
 * Outline tab: nodes nested by `part-of`, stored state as glyph and chip,
 * derived badges (active, blocked, progress) next to it. Dashed rows are
 * relations to and from other graphs.
 */
export function GraphOutline({
  graphId,
  detail,
  selectedNodeId,
  onSelectNode,
  unseenNodeIds,
}: GraphTabProps) {
  const outline = useMemo(() => buildOutline(detail.nodes), [detail.nodes])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((nodeId: string) => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  return (
    <div className="flex flex-col gap-1 px-6 py-4" data-testid="graph-outline">
      {outline.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">
          No nodes yet. Add the first one below.
        </p>
      )}
      {outline.map(item => (
        <OutlineBranch
          key={item.node.id}
          item={item}
          depth={0}
          detail={detail}
          collapsed={collapsed}
          onToggle={toggle}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          unseenNodeIds={unseenNodeIds}
        />
      ))}
      <AddNodeRow graphId={graphId} nodes={detail.nodes} />
    </div>
  )
}

interface BranchProps {
  item: OutlineItem
  depth: number
  detail: GraphDetail
  collapsed: Set<string>
  onToggle: (nodeId: string) => void
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  unseenNodeIds: ReadonlySet<string>
}

function OutlineBranch(props: BranchProps) {
  const { item, depth, detail, collapsed } = props
  const { node, children } = item
  const isCollapsed = collapsed.has(node.id)
  return (
    <div className={cn(depth === 0 && children.length > 0 && 'mb-3')}>
      <OutlineRow {...props} hasChildren={children.length > 0} />
      <ExternalRows node={node} detail={detail} depth={depth} />
      {!isCollapsed &&
        children.map(child => (
          <OutlineBranch
            {...props}
            key={child.node.id}
            item={child}
            depth={depth + 1}
          />
        ))}
    </div>
  )
}

function OutlineRow({
  item,
  depth,
  detail,
  collapsed,
  onToggle,
  selectedNodeId,
  onSelectNode,
  unseenNodeIds,
  hasChildren,
}: BranchProps & { hasChildren: boolean }) {
  const { node } = item
  const derived = detail.derived[node.id]
  const issue = issueNumber(node.attachments)
  const selected = selectedNodeId === node.id
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectNode(selected ? null : node.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelectNode(selected ? null : node.id)
        }
      }}
      data-testid={`graph-node-row-${node.id}`}
      data-depth={depth}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group flex min-h-9 cursor-pointer items-center gap-2 rounded-md pr-2 text-sm transition-colors',
        selected ? 'bg-foreground/10' : 'hover:bg-accent/50'
      )}
      style={{ paddingLeft: `${depth * 24 + 4}px` }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {hasChildren && (
          <button
            type="button"
            aria-label={collapsed.has(node.id) ? 'Expand' : 'Collapse'}
            onClick={e => {
              e.stopPropagation()
              onToggle(node.id)
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            {collapsed.has(node.id) ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        )}
      </span>
      <NodeStateGlyph state={node.state} />
      <span
        className={cn(
          'truncate',
          hasChildren && depth === 0 && 'font-semibold',
          (node.state === 'done' || node.state === 'dropped') &&
            'text-muted-foreground'
        )}
      >
        {node.title}
      </span>
      {issue && (
        <span className="shrink-0 text-xs text-muted-foreground">{issue}</span>
      )}
      {unseenNodeIds.has(node.id) && <UnseenDot />}
      {derived && derived.progressTotal > 0 && (
        <ProgressBar
          done={derived.progressDone}
          total={derived.progressTotal}
        />
      )}
      <span className="flex-1" />
      {derived?.active && <ActiveBadge />}
      {derived?.blocked && <BlockedBadge blockers={derived.blockers} />}
      {!(hasChildren && depth === 0) && <NodeStateChip state={node.state} />}
    </div>
  )
}

/**
 * Relations that cross into another graph, as dashed rows under the node:
 * incoming ones (another graph's node points here) and the node's own
 * relations to another graph.
 */
function ExternalRows({
  node,
  detail,
  depth,
}: {
  node: GraphNode
  detail: GraphDetail
  depth: number
}) {
  const incoming = (detail.incoming[node.id] ?? []).filter(r => r.external)
  const outgoing = node.relations.filter(
    r => r.kind !== 'part-of' && r.target.includes('#')
  )
  if (incoming.length === 0 && outgoing.length === 0) return null

  const row = (key: string, ref: string, text: string) => {
    const target = resolveRef(detail, ref)
    const state = detail.external[ref]?.state
    return (
      <div
        key={key}
        data-testid="graph-external-row"
        className="my-1 flex min-h-9 items-center gap-2 rounded-md border border-dashed border-border pr-2 text-sm"
        style={{ marginLeft: `${depth * 24 + 24}px`, paddingLeft: '4px' }}
      >
        {state ? (
          <NodeStateGlyph state={state} />
        ) : (
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{target.title}</span>
        <span className="shrink-0 rounded border border-blue-500/50 px-1.5 text-xs text-blue-500">
          ↗ {target.graphTitle ?? 'other graph'}
        </span>
        {target.notFound && <NotFound />}
        <span className="flex-1" />
        <span className="truncate text-xs text-muted-foreground">{text}</span>
      </div>
    )
  }

  return (
    <>
      {incoming.map(relation =>
        row(
          `in-${relation.kind}-${relation.source}`,
          relation.source,
          `${relation.kind.replace('-', ' ')} ${node.title}`
        )
      )}
      {outgoing.map(relation =>
        row(
          `out-${relation.kind}-${relation.target}`,
          relation.target,
          `${node.title} ${relation.kind.replace('-', ' ')} it`
        )
      )}
    </>
  )
}

function AddNodeRow({
  graphId,
  nodes,
}: {
  graphId: string
  nodes: GraphNode[]
}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [parent, setParent] = useState('')
  const createNode = useCreateGraphNode()

  const submit = useCallback(() => {
    const trimmed = title.trim()
    if (!trimmed) return
    createNode.mutate(
      {
        graphId,
        node: {
          title: trimmed,
          relations: parent ? [{ kind: 'part-of', target: parent }] : undefined,
        },
      },
      { onSuccess: () => setTitle('') }
    )
  }, [createNode, graphId, parent, title])

  if (!adding) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 w-fit text-muted-foreground"
        onClick={() => setAdding(true)}
      >
        <Plus className="size-4" aria-hidden="true" />
        Add node
      </Button>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-2" data-testid="graph-add-node">
      <Input
        autoFocus
        aria-label="New node title"
        placeholder="Node title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setAdding(false)
        }}
        className="max-w-sm"
      />
      <NativeSelect
        aria-label="Parent node"
        value={parent}
        onChange={e => setParent(e.target.value)}
        className="w-52"
      >
        <NativeSelectOption value="">No parent</NativeSelectOption>
        {nodes.map(node => (
          <NativeSelectOption key={node.id} value={node.id}>
            Part of: {node.title}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button
        type="button"
        size="sm"
        disabled={!title.trim() || createNode.isPending}
        onClick={submit}
      >
        Add
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setAdding(false)}
      >
        Cancel
      </Button>
    </div>
  )
}
