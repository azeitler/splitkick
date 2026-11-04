import type {
  GraphDetail,
  GraphNode,
  GraphSummary,
  NodeDerived,
} from '@/types/graphs'

/** Test-only builders for graph API values. */
export function summary(extra: Partial<GraphSummary> = {}): GraphSummary {
  return {
    id: 'g1',
    title: 'Splitkick roadmap',
    graphType: 'roadmap',
    path: '/Users/me/splitkick/.splitkick/graphs/roadmap.yml',
    locationKind: 'project-repo',
    repoRoot: '/Users/me/splitkick',
    projectId: 'p1',
    projectName: 'splitkick',
    branch: 'main',
    defaultBranch: 'main',
    offDefaultBranch: false,
    missing: false,
    error: null,
    nodeCount: 0,
    unseenChanges: 0,
    openRequests: 0,
    ...extra,
  }
}

export function node(
  id: string,
  title: string,
  extra: Partial<GraphNode> = {}
): GraphNode {
  return {
    id,
    title,
    description: '',
    state: 'committed',
    properties: [],
    relations: [],
    attachments: [],
    ...extra,
  }
}

export function derived(extra: Partial<NodeDerived> = {}): NodeDerived {
  return {
    active: false,
    blocked: false,
    blockers: [],
    progressDone: 0,
    progressTotal: 0,
    serving: [],
    ...extra,
  }
}

export function detail(extra: Partial<GraphDetail> = {}): GraphDetail {
  return {
    summary: summary(),
    nodes: [],
    derived: {},
    incoming: {},
    external: {},
    graphServing: [],
    ...extra,
  }
}
