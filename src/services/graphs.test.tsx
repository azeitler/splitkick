import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  graphsQueryKeys,
  useCreateGraph,
  useCreateGraphNode,
  useGraph,
  useGraphRequests,
  useGraphs,
  useSetSessionServes,
  useUpdateGraphNode,
} from './graphs'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toastError: vi.fn() }))

vi.mock('@/lib/transport', () => ({
  invoke: mocks.invoke,
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}))
vi.mock('@/lib/environment', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/environment')>()),
  hasBackend: () => true,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('graph services', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.toastError.mockReset()
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
  })

  it('lists graphs and reads one by id', async () => {
    mocks.invoke.mockResolvedValue([])
    const list = renderHook(() => useGraphs(), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    expect(mocks.invoke).toHaveBeenCalledWith('list_graphs')

    const one = renderHook(() => useGraph('g1'), { wrapper })
    await waitFor(() => expect(one.result.current.isSuccess).toBe(true))
    expect(mocks.invoke).toHaveBeenCalledWith('get_graph', { graphId: 'g1' })
  })

  it('does not ask for a graph without an id', () => {
    renderHook(() => useGraph(null), { wrapper })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('keys every query under graphs, so one invalidation refreshes all', () => {
    for (const key of [
      graphsQueryKeys.list(),
      graphsQueryKeys.detail('g1'),
      graphsQueryKeys.changes('g1'),
      graphsQueryKeys.requests(),
      graphsQueryKeys.location('/x.yml'),
    ]) {
      expect(key[0]).toBe('graphs')
    }
    expect(graphsQueryKeys.requests()).not.toEqual(
      graphsQueryKeys.requests('g1')
    )
  })

  it('passes graphId to list_graph_requests', async () => {
    mocks.invoke.mockResolvedValue([])
    const { result } = renderHook(() => useGraphRequests('g1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.invoke).toHaveBeenCalledWith('list_graph_requests', {
      graphId: 'g1',
    })
  })

  it('sends camelCase args to the write commands and refreshes graphs', async () => {
    mocks.invoke.mockResolvedValue({ id: 'g1' })
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const create = renderHook(() => useCreateGraph(), { wrapper })
    await act(() =>
      create.result.current.mutateAsync({
        title: 'Release 1.2',
        graphType: 'release',
        path: '/r/.splitkick/graphs/release-1-2.yml',
      })
    )
    expect(mocks.invoke).toHaveBeenCalledWith('create_graph', {
      title: 'Release 1.2',
      graphType: 'release',
      path: '/r/.splitkick/graphs/release-1-2.yml',
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['graphs'] })

    const addNode = renderHook(() => useCreateGraphNode(), { wrapper })
    await act(() =>
      addNode.result.current.mutateAsync({
        graphId: 'g1',
        node: { title: 'A', relations: [{ kind: 'part-of', target: 'p' }] },
      })
    )
    expect(mocks.invoke).toHaveBeenCalledWith('create_graph_node', {
      graphId: 'g1',
      node: { title: 'A', relations: [{ kind: 'part-of', target: 'p' }] },
    })

    const update = renderHook(() => useUpdateGraphNode(), { wrapper })
    await act(() =>
      update.result.current.mutateAsync({
        graphId: 'g1',
        nodeId: 'n1',
        patch: { state: 'done' },
      })
    )
    expect(mocks.invoke).toHaveBeenCalledWith('update_graph_node', {
      graphId: 'g1',
      nodeId: 'n1',
      patch: { state: 'done' },
    })
  })

  it('refreshes the session caches after a session command', async () => {
    mocks.invoke.mockResolvedValue(null)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSetSessionServes(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ sessionId: 's1', serves: ['g1#n1'] })
    )
    expect(mocks.invoke).toHaveBeenCalledWith('set_session_serves', {
      sessionId: 's1',
      serves: ['g1#n1'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['all-sessions'] })
  })

  it('toasts a failed write', async () => {
    mocks.invoke.mockRejectedValue('file exists')
    const { result } = renderHook(() => useCreateGraph(), { wrapper })
    await act(async () => {
      await result.current
        .mutateAsync({ title: 'x', graphType: 'roadmap', path: '/x.yml' })
        .catch(() => undefined)
    })
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Could not create the graph',
      { description: 'file exists' }
    )
  })
})
