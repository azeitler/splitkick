/**
 * Graph layer API types (camelCase over the wire).
 *
 * Contract: docs/developer/graph-layer.md. Keep in step with
 * `jean-core/src/graphs/model.rs`.
 */

export type NodeState = 'proposed' | 'committed' | 'done' | 'dropped'
export type RelationKind =
  | 'depends-on'
  | 'blocked-by'
  | 'part-of'
  | 'relates-to'
export type GraphPermission = 'read' | 'write' | 'manage'
export type GraphLocationKind = 'project-repo' | 'other-repo' | 'folder'

export const NODE_STATES: readonly NodeState[] = [
  'proposed',
  'committed',
  'done',
  'dropped',
]
export const RELATION_KINDS: readonly RelationKind[] = [
  'depends-on',
  'blocked-by',
  'part-of',
  'relates-to',
]

export interface GraphRelation {
  kind: RelationKind
  target: string
}
export interface GraphAttachment {
  kind: string
  value: string
}
export interface GraphNode {
  id: string
  title: string
  description: string
  state: NodeState
  properties: [string, string][]
  relations: GraphRelation[]
  attachments: GraphAttachment[]
}
export interface GraphSummary {
  id: string
  title: string
  graphType: string
  path: string
  locationKind: GraphLocationKind
  repoRoot: string | null
  projectId: string | null
  projectName: string | null
  branch: string | null
  defaultBranch: string | null
  /** project-repo whose checkout is not on the default branch */
  offDefaultBranch: boolean
  missing: boolean
  error: string | null
  nodeCount: number
  unseenChanges: number
  openRequests: number
}
export interface ServingSession {
  sessionId: string
  sessionName: string
  projectId: string
  worktreeId: string
  worktreeName: string
  /** run status label: running | idle | waiting | review | … */
  status: string
  agentId: string | null
}
export interface NodeDerived {
  active: boolean
  blocked: boolean
  /** human text, e.g. "depends-on Graph layer design" */
  blockers: string[]
  /** over part-of children (dropped excluded) */
  progressDone: number
  progressTotal: number
  serving: ServingSession[]
}
export interface IncomingRelation {
  kind: RelationKind
  source: string
  external: boolean
}
export interface ExternalNodeRef {
  ref: string
  graphId: string
  graphTitle: string | null
  nodeId: string
  title: string | null
  state: NodeState | null
  found: boolean
}
export interface GraphDetail {
  summary: GraphSummary
  nodes: GraphNode[]
  /** by node id */
  derived: Record<string, NodeDerived>
  /** by node id, incl. from other registered graphs */
  incoming: Record<string, IncomingRelation[]>
  /** by ref, for every cross-graph target or source */
  external: Record<string, ExternalNodeRef>
  /** sessions that serve the whole graph ("<graph-id>") */
  graphServing: ServingSession[]
}
export type GraphActor =
  | { kind: 'user' }
  | {
      kind: 'session'
      sessionId: string
      sessionName: string
      agentId: string | null
    }
export interface GraphChange {
  id: string
  graphId: string
  nodeId: string | null
  /** ms epoch */
  at: number
  actor: GraphActor
  /** node.create | node.update | node.state | node.delete | graph.update | request.answer | session.serves | revert */
  action: string
  summary: string
  why: string | null
  before: GraphNode | null
  after: GraphNode | null
  revertedBy: string | null
  /** user's own changes are always seen */
  seen: boolean
  /** session.serves: a manager linked or unlinked another session (#88) */
  serves?: ServesChange
}
/** The refs of one graph that a session.serves change added and removed. */
export interface ServesChange {
  sessionId: string
  sessionName: string
  added: string[]
  removed: string[]
}
export interface GraphRequest {
  id: string
  graphId: string
  nodeId: string
  kind: 'accept-done' | 'decision'
  title: string
  body: string
  evidence: string[]
  options: string[]
  /** decision: the blocked-by text it resolves */
  blocker: string | null
  fromSessionId: string | null
  fromSessionName: string | null
  agentId: string | null
  createdAt: number
  status: 'open' | 'accepted' | 'sent-back' | 'answered'
  answer: string | null
  answeredAt: number | null
}
export interface GraphLocationInfo {
  path: string
  exists: boolean
  locationKind: GraphLocationKind
  repoRoot: string | null
  branch: string | null
  defaultBranch: string | null
  projectId: string | null
  projectName: string | null
  offDefaultBranch: boolean
}

/** `create_graph_node` input. */
export interface NewGraphNode {
  title: string
  description?: string
  state?: NodeState
  properties?: [string, string][]
  relations?: GraphRelation[]
  attachments?: GraphAttachment[]
}

/** `update_graph_node` patch; each given list replaces the stored one. */
export type GraphNodePatch = Partial<Omit<GraphNode, 'id'>>

export type GraphRequestAction = 'accept' | 'send-back' | 'answer'

/** Saved agent profile (`AppPreferences.agent_profiles`, snake_case). */
export interface AgentProfile {
  id: string
  name: string
  color: string
  persona: string
  permission: GraphPermission
  backend: string | null
  model: string | null
  default_serves: string | null
}
