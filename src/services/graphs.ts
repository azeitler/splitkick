import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { hasBackend } from '@/lib/environment'
import { chatQueryKeys } from '@/services/chat'
import type {
  GraphChange,
  GraphDetail,
  GraphLocationInfo,
  GraphNode,
  GraphNodePatch,
  GraphPermission,
  GraphRequest,
  GraphRequestAction,
  GraphSummary,
  NewGraphNode,
} from '@/types/graphs'

/**
 * Graph layer queries and writes. Contract: docs/developer/graph-layer.md.
 *
 * Every key starts with `graphs`, so the backend's `cache:invalidate`
 * `["graphs"]` (any write, also an outside edit of a graph file) refreshes
 * all of them at once.
 */
export const graphsQueryKeys = {
  all: ['graphs'] as const,
  list: () => [...graphsQueryKeys.all, 'list'] as const,
  detail: (graphId: string) =>
    [...graphsQueryKeys.all, 'detail', graphId] as const,
  changes: (graphId: string) =>
    [...graphsQueryKeys.all, 'changes', graphId] as const,
  requests: (graphId?: string) =>
    [...graphsQueryKeys.all, 'requests', graphId ?? 'all'] as const,
  location: (path: string) =>
    [...graphsQueryKeys.all, 'location', path] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useGraphs() {
  return useQuery({
    queryKey: graphsQueryKeys.list(),
    queryFn: () => invoke<GraphSummary[]>('list_graphs'),
    enabled: hasBackend(),
  })
}

export function useGraph(graphId: string | null) {
  return useQuery({
    queryKey: graphsQueryKeys.detail(graphId ?? ''),
    queryFn: () => invoke<GraphDetail>('get_graph', { graphId }),
    enabled: hasBackend() && !!graphId,
  })
}

/** The change log of one graph, newest first. */
export function useGraphChanges(graphId: string | null) {
  return useQuery({
    queryKey: graphsQueryKeys.changes(graphId ?? ''),
    queryFn: () => invoke<GraphChange[]>('list_graph_changes', { graphId }),
    enabled: hasBackend() && !!graphId,
  })
}

/** Requests of one graph, or of every graph when `graphId` is omitted. */
export function useGraphRequests(graphId?: string) {
  return useQuery({
    queryKey: graphsQueryKeys.requests(graphId),
    queryFn: () => invoke<GraphRequest[]>('list_graph_requests', { graphId }),
    enabled: hasBackend(),
  })
}

/** Where a graph file at `path` would live (repo, branch, project). */
export function useGraphLocationInfo(path: string | null) {
  return useQuery({
    queryKey: graphsQueryKeys.location(path ?? ''),
    queryFn: () =>
      invoke<GraphLocationInfo>('get_graph_location_info', { path }),
    enabled: hasBackend() && !!path,
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * One write command: invalidates every graph query, and the session caches
 * when the command touches session metadata. Failures toast; callers that
 * need the error can still read it from `mutateAsync`.
 */
function useGraphCommand<TArgs extends Record<string, unknown>, TResult>(
  command: string,
  errorTitle: string,
  touchesSessions = false
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => invoke<TResult>(command, args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: graphsQueryKeys.all })
      if (touchesSessions) {
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.all })
        queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
      }
    },
    onError: error => {
      toast.error(errorTitle, { description: String(error) })
    },
  })
}

export const useCreateGraph = () =>
  useGraphCommand<
    { title: string; graphType: string; path: string },
    GraphSummary
  >('create_graph', 'Could not create the graph')

export const useOpenGraphFile = () =>
  useGraphCommand<{ path: string }, GraphSummary>(
    'open_graph_file',
    'Could not open the graph file'
  )

export const useRemoveGraph = () =>
  useGraphCommand<{ graphId: string }, null>(
    'remove_graph',
    'Could not remove the graph'
  )

export const useUpdateGraph = () =>
  useGraphCommand<
    { graphId: string; title?: string; graphType?: string },
    GraphSummary
  >('update_graph', 'Could not update the graph')

export const useCreateGraphNode = () =>
  useGraphCommand<
    { graphId: string; node: NewGraphNode; why?: string },
    GraphNode
  >('create_graph_node', 'Could not add the node')

/**
 * A patch's lists replace the node's lists, and the detail builds the next
 * list from the cached node. So the patch goes into the cache at once and
 * writes run one after the other: a second edit before the refetch must not
 * bring back what the first one removed.
 */
export function useUpdateGraphNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: {
      graphId: string
      nodeId: string
      patch: GraphNodePatch
      why?: string
    }) => invoke<GraphNode>('update_graph_node', args),
    scope: { id: 'update_graph_node' },
    onMutate: async ({ graphId, nodeId, patch }) => {
      const key = graphsQueryKeys.detail(graphId)
      // A refetch in flight would put the old node back.
      await queryClient.cancelQueries({ queryKey: key })
      const fields = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined)
      ) as GraphNodePatch
      queryClient.setQueryData<GraphDetail>(key, old =>
        old
          ? {
              ...old,
              nodes: old.nodes.map(node =>
                node.id === nodeId ? { ...node, ...fields } : node
              ),
            }
          : old
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: graphsQueryKeys.all })
    },
    onError: error => {
      toast.error('Could not update the node', { description: String(error) })
    },
  })
}

export const useDeleteGraphNode = () =>
  useGraphCommand<{ graphId: string; nodeId: string; why?: string }, null>(
    'delete_graph_node',
    'Could not delete the node'
  )

export const useMarkGraphChangesSeen = () =>
  useGraphCommand<{ graphId: string; changeIds?: string[] }, null>(
    'mark_graph_changes_seen',
    'Could not mark the changes as seen'
  )

export const useRevertGraphChange = () =>
  useGraphCommand<{ graphId: string; changeId: string }, null>(
    'revert_graph_change',
    'Could not revert the change'
  )

export const useAnswerGraphRequest = () =>
  useGraphCommand<
    {
      graphId: string
      requestId: string
      action: GraphRequestAction
      answer?: string
    },
    GraphRequest
  >('answer_graph_request', 'Could not answer the request', true)

export const useCommitGraph = () =>
  useGraphCommand<{ graphId: string; message?: string }, string>(
    'commit_graph',
    'Could not commit the graph'
  )

export const useSetSessionServes = () =>
  useGraphCommand<{ sessionId: string; serves: string[] }, null>(
    'set_session_serves',
    'Could not change what the session serves',
    true
  )

export const useSetSessionAgent = () =>
  useGraphCommand<
    {
      sessionId: string
      agentId: string | null
      permission?: GraphPermission
    },
    null
  >('set_session_agent', 'Could not change the session agent', true)

export const useSetSessionGraphPermission = () =>
  useGraphCommand<{ sessionId: string; permission: GraphPermission }, null>(
    'set_session_graph_permission',
    'Could not change the graph permission',
    true
  )
