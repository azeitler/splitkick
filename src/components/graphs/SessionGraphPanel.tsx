import { useMemo, useState, type ReactNode } from 'react'
import { Check, ExternalLink, Link2, Workflow, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { openGraphView } from '@/lib/graph-view'
import { openLinkToGraph } from '@/lib/link-to-graph'
import { navigateToSession } from '@/lib/navigate-to-session'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import {
  useGraph,
  useGraphChanges,
  useGraphRequests,
  useGraphs,
  useSetSessionGraphPermission,
} from '@/services/graphs'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import type { GraphDetail, GraphNode, GraphPermission } from '@/types/graphs'
import { AgentBadge } from './AgentBadge'
import {
  effectivePermission,
  GRAPH_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  useAgentProfile,
} from './agent-utils'
import {
  ActiveBadge,
  BlockedBadge,
  NodeStateChip,
  NodeStateGlyph,
  ProgressBar,
  WaitingFor,
} from './graph-badges'
import {
  GraphDetailsToggle,
  GraphRelationsToggle,
  useGraphDetailsShown,
  useGraphRelationsShown,
} from './GraphDetailsToggle'
import {
  buildOutline,
  INCOMING_LABELS,
  parentId,
  parseGraphRef,
  resolveRef,
  waitingFor,
  waitingOn,
  type OutlineItem,
} from './graph-utils'
import { ServesEditor } from './ServesEditor'

type PanelSession = Pick<
  Session,
  'id' | 'name' | 'serves' | 'agent_id' | 'graph_permission'
>

/** Whether a session gets the graph panel (serves something or has an agent). */
export function sessionHasGraphPanel(
  session: Pick<Session, 'serves' | 'agent_id'> | null | undefined
): boolean {
  return !!session && ((session.serves?.length ?? 0) > 0 || !!session.agent_id)
}

/**
 * The session graph panel (mockup screen 7), right of the chat. The simple
 * layer is one card: a worker (serves a node) sees its node, what it waits
 * for and what comes next; a manager (serves a whole graph) sees progress,
 * open requests and new changes. A worker also gets the "Relationships"
 * foldout (before and after, siblings). "Show details" opens the expert
 * layer: id, other sessions, lists, outline, permission and links editor.
 */
export function SessionGraphPanel({ session }: { session: PanelSession }) {
  const serves = session.serves ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const current =
    picked && serves.includes(picked) ? picked : (serves[0] ?? null)
  const { graphId, nodeId } = current
    ? parseGraphRef(current)
    : { graphId: null, nodeId: null }
  const { data: detail } = useGraph(graphId)
  const showDetails = useGraphDetailsShown()
  const showRelations = useGraphRelationsShown()

  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-y-auto font-sans"
      data-testid="session-graph-panel"
    >
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="flex flex-1 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Workflow className="size-3.5" aria-hidden="true" />
          Graph
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Close graph panel"
          onClick={() => useChatStore.getState().setGraphPanelVisible(false)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>

      {serves.length > 1 && (
        <div className="border-b px-4 py-2">
          <RefPicker refs={serves} value={current} onChange={setPicked} />
        </div>
      )}

      {serves.length === 0 && (
        <div className="flex flex-col gap-2 border-b p-4 text-sm">
          <p className="text-muted-foreground">
            This session is not linked to a graph.
          </p>
          <LinkButton session={session} label="Link to Graph…" />
        </div>
      )}

      {graphId && detail && nodeId && (
        <WorkerCard
          session={session}
          graphId={graphId}
          nodeId={nodeId}
          detail={detail}
        />
      )}
      {graphId && detail && !nodeId && (
        <ManagerCard session={session} graphId={graphId} detail={detail} />
      )}

      {graphId && detail && nodeId && (
        <>
          <GraphRelationsToggle count={relationCount(detail, nodeId)} />
          {showRelations && (
            <div data-testid="session-graph-relations">
              <WorkerRelations nodeId={nodeId} detail={detail} />
            </div>
          )}
        </>
      )}

      <GraphDetailsToggle />

      {showDetails && (
        <div data-testid="session-graph-expert">
          {graphId && detail && nodeId && (
            <WorkerDetails session={session} nodeId={nodeId} detail={detail} />
          )}
          {graphId && detail && !nodeId && (
            <ManagerDetails graphId={graphId} detail={detail} />
          )}
          <PermissionSection session={session} />
          <ServesSection session={session} />
        </div>
      )}
    </aside>
  )
}

/** What the Relationships foldout lists: before, after and siblings. */
function relationCount(detail: GraphDetail, nodeId: string): number {
  const node = detail.nodes.find(n => n.id === nodeId)
  if (!node) return 0
  const ids = new Set(detail.nodes.map(n => n.id))
  const before = node.relations.filter(
    r => r.kind === 'depends-on' || r.kind === 'blocked-by'
  ).length
  const after = (detail.incoming[nodeId] ?? []).filter(
    r => r.kind !== 'part-of'
  ).length
  const parent = parentId(node, ids)
  const siblings = parent
    ? detail.nodes.filter(n => n.id !== nodeId && parentId(n, ids) === parent)
        .length
    : 0
  return before + after + siblings
}

/** Opens the Link to Graph dialog, the one place to change links. */
function LinkButton({
  session,
  label,
}: {
  session: PanelSession
  label: string
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="w-fit"
      onClick={() => openLinkToGraph(session)}
    >
      <Link2 className="size-3.5" aria-hidden="true" />
      {label}
    </Button>
  )
}

/** Graph title as a link, the first line of a card. */
function GraphLink({ graphId, title }: { graphId: string; title: string }) {
  return (
    <button
      type="button"
      className="w-fit truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      onClick={() => openGraphView(graphId)}
    >
      {title}
    </button>
  )
}

/** Small picker over the refs a session serves (graph title › node title). */
function RefPicker({
  refs,
  value,
  onChange,
}: {
  refs: string[]
  value: string | null
  onChange: (ref: string) => void
}) {
  const { data: graphs } = useGraphs()
  const label = (ref: string) => {
    const { graphId, nodeId } = parseGraphRef(ref)
    const title = graphs?.find(g => g.id === graphId)?.title ?? graphId
    return nodeId ? `${title} › ${nodeId}` : `${title} (whole graph)`
  }
  return (
    <NativeSelect
      aria-label="Graph or node"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-full"
    >
      {refs.map(ref => (
        <NativeSelectOption key={ref} value={ref}>
          {label(ref)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-b px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function NodeLine({
  node,
  title,
  label,
  trailing,
  highlight,
}: {
  node: GraphNode | undefined
  title: string
  label?: string
  trailing?: ReactNode
  highlight?: boolean
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded px-1 py-0.5 text-sm',
        highlight && 'bg-orange-500/10'
      )}
    >
      {label && (
        <span className="w-20 shrink-0 text-xs text-muted-foreground italic">
          {label}
        </span>
      )}
      {node ? (
        <NodeStateGlyph state={node.state} />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing}
    </li>
  )
}

function WorkerCard({
  session,
  graphId,
  nodeId,
  detail,
}: {
  session: PanelSession
  graphId: string
  nodeId: string
  detail: GraphDetail
}) {
  const node = detail.nodes.find(n => n.id === nodeId)
  const derived = detail.derived[nodeId]

  if (!node) {
    return (
      <div className="flex flex-col gap-2 border-b p-4 text-sm">
        <p className="text-muted-foreground">
          The node {nodeId} is not in this graph any more.
        </p>
        <LinkButton session={session} label="Change link…" />
      </div>
    )
  }

  const next = waitingOn(detail, nodeId)
  return (
    <div
      className="flex flex-col gap-2 border-b p-4"
      data-testid="session-graph-node-card"
    >
      <GraphLink graphId={graphId} title={detail.summary.title} />
      <div className="text-base leading-snug font-semibold">{node.title}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <NodeStateChip state={node.state} />
        {derived?.active && <ActiveBadge />}
      </div>
      <WaitingFor
        items={waitingFor(detail, node)}
        onOpen={id => openGraphView(graphId, id)}
      />
      {next.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="graph-next">
          Next:{' '}
          {next.map((n, i) => (
            <span key={n.id}>
              {i > 0 && ', '}
              <button
                type="button"
                className="text-foreground underline-offset-2 hover:underline"
                onClick={() => openGraphView(graphId, n.id)}
              >
                {n.title}
              </button>
            </span>
          ))}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => openGraphView(graphId, nodeId)}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Open in graph
        </Button>
        <LinkButton session={session} label="Change link…" />
      </div>
    </div>
  )
}

/** Relationships foldout of a worker: before and after, and the siblings. */
function WorkerRelations({
  nodeId,
  detail,
}: {
  nodeId: string
  detail: GraphDetail
}) {
  const node = detail.nodes.find(n => n.id === nodeId)
  const derived = detail.derived[nodeId]
  const ids = useMemo(() => new Set(detail.nodes.map(n => n.id)), [detail])
  if (!node) return null

  const before = node.relations
    .filter(r => r.kind === 'depends-on' || r.kind === 'blocked-by')
    .map(r => ({ kind: r.kind, ref: r.target }))
  const after = (detail.incoming[nodeId] ?? []).filter(
    r => r.kind !== 'part-of'
  )
  const parent = parentId(node, ids)
  const parentNode = parent ? detail.nodes.find(n => n.id === parent) : null
  const siblings = parent
    ? detail.nodes.filter(n => parentId(n, ids) === parent)
    : []
  const parentDerived = parent ? detail.derived[parent] : undefined

  return (
    <>
      <Section title="Before and after">
        <ul className="flex flex-col gap-0.5">
          {before.map(({ kind, ref }) => {
            const target = resolveRef(detail, ref)
            return (
              <NodeLine
                key={`${kind}:${ref}`}
                label={kind === 'depends-on' ? 'depends on' : 'blocked by'}
                node={detail.nodes.find(n => n.id === target.nodeId)}
                title={target.graphTitle ? `${target.title} ↗` : target.title}
              />
            )
          })}
          {after.map(incoming => {
            const source = resolveRef(detail, incoming.source)
            const sourceNode = detail.nodes.find(n => n.id === source.nodeId)
            const sourceDerived = source.nodeId
              ? detail.derived[source.nodeId]
              : undefined
            return (
              <NodeLine
                key={`${incoming.kind}:${incoming.source}`}
                label={INCOMING_LABELS[incoming.kind]}
                node={sourceNode}
                title={source.graphTitle ? `${source.title} ↗` : source.title}
                trailing={
                  sourceDerived?.blocked ? (
                    <BlockedBadge blockers={sourceDerived.blockers} />
                  ) : undefined
                }
              />
            )
          })}
        </ul>
        {before.length === 0 && after.length === 0 && (
          <p className="text-sm text-muted-foreground">No relations.</p>
        )}
        {!derived?.blocked && (
          <p className="mt-2 flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
            <Check className="size-3" aria-hidden="true" />
            Nothing blocks this node.
          </p>
        )}
      </Section>

      {parentNode && (
        <Section
          title={`Part of: ${parentNode.title}`}
          aside={
            parentDerived && parentDerived.progressTotal > 0 ? (
              <ProgressBar
                done={parentDerived.progressDone}
                total={parentDerived.progressTotal}
              />
            ) : undefined
          }
        >
          <ul className="flex flex-col gap-0.5" data-testid="graph-siblings">
            {siblings.map(sibling => (
              <NodeLine
                key={sibling.id}
                node={sibling}
                title={sibling.title}
                highlight={sibling.id === nodeId}
                trailing={
                  sibling.id === nodeId ? (
                    <span className="rounded border border-orange-500/50 px-1 text-[10px] text-orange-500">
                      this session
                    </span>
                  ) : undefined
                }
              />
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

/** Expert layer of a worker: the file id and state, other sessions. */
function WorkerDetails({
  session,
  nodeId,
  detail,
}: {
  session: PanelSession
  nodeId: string
  detail: GraphDetail
}) {
  const node = detail.nodes.find(n => n.id === nodeId)
  if (!node) return null
  const others = (detail.derived[nodeId]?.serving ?? []).filter(
    s => s.sessionId !== session.id
  )
  return (
    <>
      <p className="border-b px-4 py-2 font-mono text-xs text-muted-foreground">
        id {node.id} · state {node.state}
      </p>
      <Section title="Other sessions on this node">
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {others.map(other => (
              <li key={other.sessionId}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm hover:bg-accent/50"
                  onClick={() =>
                    navigateToSession({
                      projectId: other.projectId,
                      worktreeId: other.worktreeId,
                      sessionId: other.sessionId,
                    })
                  }
                >
                  <span className="truncate">{other.sessionName}</span>
                  <AgentBadge
                    agentId={other.agentId}
                    sessionName={other.sessionName}
                  />
                  <span className="truncate text-xs text-muted-foreground">
                    {other.worktreeName} · {other.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

function ManagerCard({
  session,
  graphId,
  detail,
}: {
  session: PanelSession
  graphId: string
  detail: GraphDetail
}) {
  const { data: requests } = useGraphRequests(graphId)
  const { data: changes } = useGraphChanges(graphId)
  const open = (requests ?? []).filter(r => r.status === 'open').length
  const unseen = (changes ?? []).filter(c => !c.seen).length
  const counted = detail.nodes.filter(n => n.state !== 'dropped')
  const done = counted.filter(n => n.state === 'done').length

  return (
    <div
      className="flex flex-col gap-2 border-b p-4 text-sm"
      data-testid="session-graph-manager-card"
    >
      <GraphLink graphId={graphId} title={detail.summary.title} />
      <p className="text-muted-foreground">
        This session looks after the whole graph.
      </p>
      <ProgressBar done={done} total={counted.length} />
      {open > 0 && (
        <button
          type="button"
          className="w-fit text-left text-orange-600 hover:underline dark:text-orange-400"
          onClick={() => openGraphView(graphId)}
        >
          {open === 1
            ? '1 request waits for you'
            : `${open} requests wait for you`}
        </button>
      )}
      {unseen > 0 && (
        <button
          type="button"
          className="w-fit text-left text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => openGraphView(graphId)}
        >
          {unseen === 1 ? '1 new change' : `${unseen} new changes`}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => openGraphView(graphId)}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Open graph
        </Button>
        <LinkButton session={session} label="Change link…" />
      </div>
    </div>
  )
}

function ManagerDetails({
  graphId,
  detail,
}: {
  graphId: string
  detail: GraphDetail
}) {
  const { data: requests } = useGraphRequests(graphId)
  const { data: changes } = useGraphChanges(graphId)
  const open = (requests ?? []).filter(r => r.status === 'open')
  const unseen = (changes ?? []).filter(c => !c.seen)
  const outline = useMemo(() => buildOutline(detail.nodes), [detail.nodes])
  const titleOf = (nodeId: string | null) =>
    detail.nodes.find(n => n.id === nodeId)?.title ?? nodeId ?? 'graph'

  return (
    <>
      <Section title={`Open requests (${open.length})`}>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="panel-requests">
            {open.map(request => (
              <li key={request.id}>
                <button
                  type="button"
                  className="w-full truncate rounded px-1 py-0.5 text-left text-sm hover:bg-accent/50"
                  onClick={() => openGraphView(graphId, request.nodeId)}
                >
                  <span className="text-xs text-muted-foreground">
                    {request.kind === 'decision' ? 'decision' : 'accept done'}
                    {' · '}
                  </span>
                  {request.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Changes the user has not seen (${unseen.length})`}>
        {unseen.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="panel-changes">
            {unseen.map(change => (
              <li key={change.id} className="text-sm">
                <span className="text-muted-foreground">
                  {titleOf(change.nodeId)}:{' '}
                </span>
                {change.summary}
                <span
                  className="ml-1 text-xs text-muted-foreground"
                  title={new Date(change.at).toLocaleString()}
                >
                  {formatRelativeTime(change.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Outline">
        <ul className="flex flex-col gap-0.5">
          {outline.map(item => (
            <CompactOutlineItem
              key={item.node.id}
              graphId={graphId}
              item={item}
              depth={0}
            />
          ))}
        </ul>
      </Section>
    </>
  )
}

function CompactOutlineItem({
  graphId,
  item,
  depth,
}: {
  graphId: string
  item: OutlineItem
  depth: number
}) {
  return (
    <>
      <li>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded py-0.5 pr-1 text-left text-sm hover:bg-accent/50"
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => openGraphView(graphId, item.node.id)}
        >
          <NodeStateGlyph state={item.node.state} className="size-3.5" />
          <span className="truncate">{item.node.title}</span>
        </button>
      </li>
      {item.children.map(child => (
        <CompactOutlineItem
          key={child.node.id}
          graphId={graphId}
          item={child}
          depth={depth + 1}
        />
      ))}
    </>
  )
}

function PermissionSection({ session }: { session: PanelSession }) {
  const agent = useAgentProfile(session.agent_id)
  const setPermission = useSetSessionGraphPermission()
  const permission = effectivePermission(session.graph_permission, agent)

  return (
    <Section title="This session may">
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Graph permission"
            value={permission}
            onChange={e =>
              setPermission.mutate({
                sessionId: session.id,
                permission: e.target.value as GraphPermission,
              })
            }
            className="h-8 w-28 py-0"
          >
            {GRAPH_PERMISSIONS.map(level => (
              <NativeSelectOption key={level} value={level}>
                {level}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {agent && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              from
              <AgentBadge agentId={agent.id} />
            </span>
          )}
        </div>
        <p className="text-muted-foreground">
          {PERMISSION_DESCRIPTIONS[permission]}
        </p>
      </div>
    </Section>
  )
}

function ServesSection({ session }: { session: PanelSession }) {
  return (
    <Section title="Serves">
      <ServesEditor sessionId={session.id} serves={session.serves ?? []} />
    </Section>
  )
}
