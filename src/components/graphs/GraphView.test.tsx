import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { GraphView } from './GraphView'
import { detail, summary } from './graph-test-fixtures'

const mocks = vi.hoisted(() => ({
  graph: { data: undefined, error: null, isLoading: false } as {
    data: unknown
    error: unknown
    isLoading: boolean
  },
  updateGraph: vi.fn(),
  mutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/services/graphs', () => ({
  useGraph: () => mocks.graph,
  useGraphChanges: () => ({ data: [] }),
  useUpdateGraph: () => ({ ...mocks.mutation(), mutate: mocks.updateGraph }),
  useCommitGraph: () => mocks.mutation(),
  useRemoveGraph: () => mocks.mutation(),
  useCreateGraphNode: () => mocks.mutation(),
}))

describe('GraphView', () => {
  beforeEach(() => {
    mocks.graph = { data: detail(), error: null, isLoading: false }
    mocks.updateGraph.mockReset()
  })

  it('shows the error, not the last good data, when a refetch fails', () => {
    // TanStack Query keeps `data` after a failed refetch (file deleted or broken).
    mocks.graph = {
      data: detail(),
      error: 'Graph file not found: /x/g.yml',
      isLoading: false,
    }
    render(<GraphView graphId="g1" />)
    expect(screen.getByTestId('graph-load-error')).toHaveTextContent(
      'Could not load the graph. Graph file not found: /x/g.yml'
    )
    expect(screen.queryByTestId('graph-outline')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Remove from list/ })
    ).toBeInTheDocument()
  })

  it('edits the type inline', async () => {
    mocks.graph = {
      data: detail({ summary: summary({ graphType: 'roadmap' }) }),
      error: null,
      isLoading: false,
    }
    render(<GraphView graphId="g1" />)
    await userEvent.click(screen.getByTestId('graph-type'))
    const input = screen.getByLabelText('Graph type')
    await userEvent.clear(input)
    await userEvent.type(input, 'release{Enter}')
    expect(mocks.updateGraph).toHaveBeenCalledWith({
      graphId: 'g1',
      graphType: 'release',
    })
  })
})
