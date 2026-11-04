import type { GraphDetail, GraphNode, NodeState } from '@/types/graphs'
import { buildOutline } from './graph-utils'

/**
 * Layout of the Dependencies tab (mockup screen 2b), a pure function of
 * `GraphDetail`. Grid units only; the component turns them into pixels.
 *
 * - Columns are dependency **steps**: a node with no `depends-on` inside the
 *   graph is step 0, else one more than its deepest target. Column 0 of the
 *   view is "Open decisions", so a bar in step `s` sits in view column `s + 1`.
 * - Lanes are the `part-of` roots that have parts (the root itself is the
 *   lane header, not a bar), then "No group" (roots without parts), then
 *   "Other graphs" (cross-graph targets and sources).
 */

export const DECISION_COLUMN = 0

export interface DependencyLane {
  key: string
  title: string
  /** Same-graph root node of the group, null for "No group" and "Other graphs". */
  nodeId: string | null
  progressDone: number
  progressTotal: number
  external: boolean
  /** Rows the lane needs: the tallest column stack, at least 1. */
  rows: number
}

export interface DependencyBar {
  /** Node id, or the `<graph-id>#<node-id>` ref of an external node. */
  key: string
  nodeId: string | null
  externalRef: string | null
  title: string
  state: NodeState | null
  graphTitle: string | null
  lane: number
  /** View column (step + 1). */
  column: number
  row: number
}

export interface DependencyDecision {
  key: string
  text: string
  /** Node the open decision blocks. */
  nodeId: string
  lane: number
  row: number
}

export interface DependencyEdge {
  key: string
  /** Bar key the arrow starts at (the target that comes first). */
  from: string
  /** Bar key the arrow ends at. */
  to: string
  kind: 'depends-on' | 'relates-to'
  /** depends-on only: the target is done (grey instead of red). */
  done: boolean
}

export interface DependencyLayout {
  lanes: DependencyLane[]
  bars: DependencyBar[]
  decisions: DependencyDecision[]
  edges: DependencyEdge[]
  /** View columns including "Open decisions". */
  columns: number
}

/** Step of every node: longest `depends-on` path inside the graph. */
export function dependencySteps(nodes: GraphNode[]): Map<string, number> {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const steps = new Map<string, number>()
  const visiting = new Set<string>()

  const step = (node: GraphNode): number => {
    const known = steps.get(node.id)
    if (known !== undefined) return known
    // A cycle: count the node seen again as step 0, so the walk ends.
    if (visiting.has(node.id)) return 0
    visiting.add(node.id)
    let value = 0
    for (const relation of node.relations) {
      if (relation.kind !== 'depends-on') continue
      const target = byId.get(relation.target)
      if (target && target.id !== node.id) {
        value = Math.max(value, step(target) + 1)
      }
    }
    visiting.delete(node.id)
    steps.set(node.id, value)
    return value
  }

  for (const node of nodes) step(node)
  return steps
}

/** Free-text `blocked-by` targets of a node (open decisions). */
function openDecisions(node: GraphNode, ids: ReadonlySet<string>): string[] {
  return node.relations
    .filter(
      r =>
        r.kind === 'blocked-by' && !ids.has(r.target) && !r.target.includes('#')
    )
    .map(r => r.target)
}

export function buildDependencyLayout(detail: GraphDetail): DependencyLayout {
  const { nodes } = detail
  const ids = new Set(nodes.map(n => n.id))
  const steps = dependencySteps(nodes)

  // Lanes from the part-of outline: a root with parts is a group.
  const lanes: DependencyLane[] = []
  const laneOf = new Map<string, number>()
  const groupRoots = new Set<string>()
  const ungrouped: string[] = []
  const collect = (
    item: ReturnType<typeof buildOutline>[number],
    lane: number
  ) => {
    laneOf.set(item.node.id, lane)
    for (const child of item.children) collect(child, lane)
  }
  for (const item of buildOutline(nodes)) {
    if (item.children.length === 0) {
      ungrouped.push(item.node.id)
      continue
    }
    const derived = detail.derived[item.node.id]
    groupRoots.add(item.node.id)
    lanes.push({
      key: item.node.id,
      title: item.node.title,
      nodeId: item.node.id,
      progressDone: derived?.progressDone ?? 0,
      progressTotal: derived?.progressTotal ?? 0,
      external: false,
      rows: 1,
    })
    for (const child of item.children) collect(child, lanes.length - 1)
  }
  if (ungrouped.length > 0) {
    lanes.push({
      key: '__no-group',
      title: 'No group',
      nodeId: null,
      progressDone: 0,
      progressTotal: 0,
      external: false,
      rows: 1,
    })
    for (const id of ungrouped) laneOf.set(id, lanes.length - 1)
  }

  // Stack bars and decisions per lane and column, in file order.
  const stack = new Map<string, number>()
  const nextRow = (lane: number, column: number) => {
    const key = `${lane}:${column}`
    const row = stack.get(key) ?? 0
    stack.set(key, row + 1)
    const target = lanes[lane]
    if (target) target.rows = Math.max(target.rows, row + 1)
    return row
  }

  const bars: DependencyBar[] = []
  const decisions: DependencyDecision[] = []
  let maxColumn = 1
  for (const node of nodes) {
    if (groupRoots.has(node.id)) continue
    const lane = laneOf.get(node.id)
    if (lane === undefined) continue
    const column = (steps.get(node.id) ?? 0) + 1
    maxColumn = Math.max(maxColumn, column)
    bars.push({
      key: node.id,
      nodeId: node.id,
      externalRef: null,
      title: node.title,
      state: node.state,
      graphTitle: null,
      lane,
      column,
      row: nextRow(lane, column),
    })
  }
  // Decisions on group roots show in the root's own lane.
  for (const node of nodes) {
    const lane =
      laneOf.get(node.id) ?? lanes.findIndex(l => l.nodeId === node.id)
    if (lane < 0) continue
    for (const text of openDecisions(node, ids)) {
      decisions.push({
        key: `${node.id}:${text}`,
        text,
        nodeId: node.id,
        lane,
        row: nextRow(lane, DECISION_COLUMN),
      })
    }
  }

  // Edges inside the graph, and the external refs they reach.
  const barKeys = new Set(bars.map(b => b.key))
  const edges: DependencyEdge[] = []
  const externalColumn = new Map<string, number>()
  const linkExternal = (ref: string, column: number) => {
    externalColumn.set(ref, Math.max(externalColumn.get(ref) ?? 0, column))
  }
  for (const node of nodes) {
    if (!barKeys.has(node.id)) continue
    const column = (steps.get(node.id) ?? 0) + 1
    for (const relation of node.relations) {
      const { kind, target } = relation
      if (kind !== 'depends-on' && kind !== 'relates-to') continue
      if (barKeys.has(target)) {
        if (kind !== 'depends-on') continue
        const targetNode = nodes.find(n => n.id === target)
        edges.push({
          key: `${node.id}>${target}:${kind}`,
          from: target,
          to: node.id,
          kind,
          done: targetNode?.state === 'done',
        })
      } else if (target.includes('#')) {
        linkExternal(target, column)
        edges.push({
          key: `${node.id}>${target}:${kind}`,
          from: kind === 'depends-on' ? target : node.id,
          to: kind === 'depends-on' ? node.id : target,
          kind,
          done: detail.external[target]?.state === 'done',
        })
      }
    }
    // Other graphs that point here.
    for (const incoming of detail.incoming[node.id] ?? []) {
      if (!incoming.external) continue
      if (incoming.kind !== 'depends-on' && incoming.kind !== 'relates-to') {
        continue
      }
      linkExternal(incoming.source, column)
      edges.push({
        key: `${incoming.source}>${node.id}:${incoming.kind}`,
        from: node.id,
        to: incoming.source,
        kind: incoming.kind,
        done: node.state === 'done',
      })
    }
  }

  if (externalColumn.size > 0) {
    lanes.push({
      key: '__other-graphs',
      title: 'Other graphs',
      nodeId: null,
      progressDone: 0,
      progressTotal: 0,
      external: true,
      rows: 1,
    })
    const lane = lanes.length - 1
    for (const [ref, column] of externalColumn) {
      const external = detail.external[ref]
      bars.push({
        key: ref,
        nodeId: null,
        externalRef: ref,
        title: external?.title ?? ref,
        state: external?.state ?? null,
        graphTitle: external?.graphTitle ?? null,
        lane,
        column,
        row: nextRow(lane, column),
      })
    }
  }

  return { lanes, bars, decisions, edges, columns: maxColumn + 1 }
}
