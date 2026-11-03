import type {
  GraphAttachment,
  GraphDetail,
  GraphNode,
  GraphSummary,
  RelationKind,
} from '@/types/graphs'

/** `/Users/me/Graphs` → `~/Graphs` (macOS and Linux home folders). */
export function tildePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
}

/** Last segment of a path, without a trailing separator. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() ?? trimmed
}

/** Folder that holds `path`. */
export function dirName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index > 0 ? trimmed.slice(0, index) : trimmed
}

/** Join a base folder and a relative path with one separator. */
export function joinPath(base: string, relative: string): string {
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${relative.replace(/^[\\/]+/, '')}`
}

/** Where a graph file lives, for the sidebar's second line. */
export function graphWhere(summary: GraphSummary): string {
  switch (summary.locationKind) {
    case 'project-repo':
      return `${summary.projectName ?? baseName(summary.repoRoot ?? summary.path)} repo`
    case 'other-repo':
      return `${baseName(summary.repoRoot ?? dirName(summary.path))} repo`
    case 'folder':
      return tildePath(dirName(summary.path))
  }
}

/** The sidebar row's second line: `type · where` (no dot without a type). */
export function graphSubtitle(summary: GraphSummary): string {
  return [summary.graphType.trim(), graphWhere(summary)]
    .filter(Boolean)
    .join(' · ')
}

/** `path` relative to the repo root, or the `~` path outside a repo. */
export function graphRelativePath(summary: GraphSummary): string {
  const root = summary.repoRoot
  if (root && summary.path.startsWith(root)) {
    return summary.path.slice(root.length).replace(/^[\\/]+/, '')
  }
  return tildePath(summary.path)
}

/** `Release 1.2` → `release-1-2`. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'graph'
  )
}

/** Same-graph target of the node's first `part-of`, if it resolves. */
export function parentId(
  node: GraphNode,
  ids: ReadonlySet<string>
): string | null {
  const relation = node.relations.find(r => r.kind === 'part-of')
  return relation && ids.has(relation.target) ? relation.target : null
}

export interface OutlineItem {
  node: GraphNode
  children: OutlineItem[]
}

/**
 * Nodes nested by `part-of`, in file order. A node whose parent is missing
 * or in another graph is a root; a `part-of` cycle is broken at the first
 * node seen again, so every node shows exactly once.
 */
export function buildOutline(nodes: GraphNode[]): OutlineItem[] {
  const ids = new Set(nodes.map(n => n.id))
  const childrenOf = new Map<string, GraphNode[]>()
  const roots: GraphNode[] = []
  for (const node of nodes) {
    const parent = parentId(node, ids)
    if (parent && parent !== node.id) {
      const list = childrenOf.get(parent) ?? []
      list.push(node)
      childrenOf.set(parent, list)
    } else {
      roots.push(node)
    }
  }

  const placed = new Set<string>()
  const build = (node: GraphNode): OutlineItem => {
    placed.add(node.id)
    const children = (childrenOf.get(node.id) ?? [])
      .filter(child => !placed.has(child.id))
      .map(build)
    return { node, children }
  }
  const outline = roots.map(build)
  // Nodes only reachable through a cycle: show them at the top level.
  for (const node of nodes) {
    if (!placed.has(node.id)) outline.push(build(node))
  }
  return outline
}

const ISSUE_REF = /^([\w.-]+)\/([\w.-]+)#(\d+)$/

/** `#78` for an `issue` or `pr` attachment, the first one wins. */
export function issueNumber(attachments: GraphAttachment[]): string | null {
  for (const attachment of attachments) {
    if (attachment.kind !== 'issue' && attachment.kind !== 'pr') continue
    const match = attachment.value.match(/#(\d+)$/)
    if (match) return `#${match[1]}`
  }
  return null
}

/** Web URL of an attachment, when it has one. */
export function attachmentUrl(attachment: GraphAttachment): string | null {
  const value = attachment.value.trim()
  if (/^https?:\/\//.test(value)) return value
  if (attachment.kind === 'issue' || attachment.kind === 'pr') {
    const match = value.match(ISSUE_REF)
    if (match) {
      const path = attachment.kind === 'pr' ? 'pull' : 'issues'
      return `https://github.com/${match[1]}/${match[2]}/${path}/${match[3]}`
    }
  }
  return null
}

/** How an incoming relation reads from the target node. */
export const INCOMING_LABELS: Record<RelationKind, string> = {
  'depends-on': 'needed by',
  'blocked-by': 'blocks',
  'part-of': 'has part',
  'relates-to': 'related from',
}

export interface ResolvedTarget {
  title: string
  /** Same-graph node id, when the target is one. */
  nodeId: string | null
  /** Title of the other graph, for a cross-graph ref. */
  graphTitle: string | null
  /** Neither a node here nor a cross-graph ref: free text. */
  freeText: boolean
}

/** Title and kind of a relation target or source (contract: file format). */
export function resolveRef(detail: GraphDetail, ref: string): ResolvedTarget {
  const local = detail.nodes.find(n => n.id === ref)
  if (local) {
    return {
      title: local.title,
      nodeId: local.id,
      graphTitle: null,
      freeText: false,
    }
  }
  if (ref.includes('#')) {
    const external = detail.external[ref]
    return {
      title: external?.title ?? ref,
      nodeId: null,
      graphTitle: external?.graphTitle ?? null,
      freeText: false,
    }
  }
  return { title: ref, nodeId: null, graphTitle: null, freeText: true }
}

/** Node ids with changes the user has not seen. */
export function unseenNodeIds(
  changes: { nodeId: string | null; seen: boolean }[] | undefined
): Set<string> {
  const ids = new Set<string>()
  for (const change of changes ?? []) {
    if (!change.seen && change.nodeId) ids.add(change.nodeId)
  }
  return ids
}

/** `<graph-id>#<node-id>` → `{ graphId, nodeId }`; a whole-graph ref has no node. */
export function parseGraphRef(ref: string): {
  graphId: string
  nodeId: string | null
} {
  const index = ref.indexOf('#')
  return index < 0
    ? { graphId: ref, nodeId: null }
    : { graphId: ref.slice(0, index), nodeId: ref.slice(index + 1) || null }
}

/** Inverse of `parseGraphRef`. */
export function graphRef(graphId: string, nodeId: string | null): string {
  return nodeId ? `${graphId}#${nodeId}` : graphId
}
