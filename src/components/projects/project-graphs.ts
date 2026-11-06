import { parseGraphRef } from '@/components/graphs/graph-utils'
import type { Session } from '@/types/chat'
import type { GraphSummary } from '@/types/graphs'

/** One row of a project's Graphs section (#99). */
export interface ProjectGraphEntry {
  graph: GraphSummary
  /** Stored elsewhere (other project, other repo, folder) and served from here. */
  served: boolean
}

/** Graph ids that the project's live sessions serve (whole graph or a node). */
export function collectServedGraphIds(
  sessions: Iterable<Pick<Session, 'serves' | 'archived_at'>>
): Set<string> {
  const ids = new Set<string>()
  for (const session of sessions) {
    if (session.archived_at) continue
    for (const ref of session.serves ?? []) {
      const { graphId } = parseGraphRef(ref)
      if (graphId) ids.add(graphId)
    }
  }
  return ids
}

const byTitle = (a: ProjectGraphEntry, b: ProjectGraphEntry) =>
  a.graph.title.localeCompare(b.graph.title, undefined, {
    sensitivity: 'base',
  }) || a.graph.id.localeCompare(b.graph.id)

/**
 * The graphs relevant to one project: stored in it, or served by one of its
 * sessions. Stored graphs come first, then served ones; each group by title.
 */
export function selectProjectGraphs(
  graphs: readonly GraphSummary[],
  projectId: string,
  servedGraphIds: ReadonlySet<string>
): ProjectGraphEntry[] {
  const stored: ProjectGraphEntry[] = []
  const served: ProjectGraphEntry[] = []
  for (const graph of graphs) {
    if (graph.projectId === projectId) {
      stored.push({ graph, served: false })
    } else if (servedGraphIds.has(graph.id)) {
      served.push({ graph, served: true })
    }
  }
  return [...stored.sort(byTitle), ...served.sort(byTitle)]
}
