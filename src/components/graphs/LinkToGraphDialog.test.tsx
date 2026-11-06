import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { LinkToGraphDialog } from './LinkToGraphDialog'
import { detail, node } from './graph-test-fixtures'

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  graphs: [{ id: 'g1', title: 'Release 1.6' }] as {
    id: string
    title: string
  }[],
}))

vi.mock('@/services/graphs', () => ({
  useGraphs: () => ({ data: mocks.graphs, isLoading: false }),
  useGraph: (id: string | null) => ({
    data: id
      ? detail({ nodes: [node('n1', 'Windows build'), node('n2', 'Docs')] })
      : undefined,
  }),
  useChangeSessionServes: () => ({ mutate: mocks.change, isPending: false }),
}))

function open(serves: string[]) {
  useUIStore.setState({
    linkToGraphTarget: { sessionId: 's1', sessionName: 'Worker', serves },
  })
  render(<LinkToGraphDialog />)
}

describe('LinkToGraphDialog (#88)', () => {
  beforeEach(() => {
    mocks.change.mockReset()
    mocks.graphs = [{ id: 'g1', title: 'Release 1.6' }]
  })

  it('shows the current links with graph and node titles', () => {
    open(['g1#n1', 'g1'])
    expect(screen.getByText('Release 1.6 › Windows build')).toBeInTheDocument()
    expect(screen.getByText('Release 1.6 (whole graph)')).toBeInTheDocument()
  })

  it('adds a node link and shows the saved result', async () => {
    mocks.change.mockImplementation(
      (_args, options: { onSuccess: (next: string[]) => void }) =>
        options.onSuccess(['g1#n2'])
    )
    open([])
    expect(screen.getByText('Not linked to a graph yet.')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.selectOptions(screen.getByLabelText('Serves graph'), 'g1')
    await user.selectOptions(screen.getByLabelText('Serves node'), 'n2')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(mocks.change).toHaveBeenCalledWith(
      { sessionId: 's1', add: ['g1#n2'] },
      expect.anything()
    )
    expect(screen.getByText('Release 1.6 › Docs')).toBeInTheDocument()
  })

  it('removes one link', async () => {
    open(['g1#n1', 'g1'])
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Stop serving Release 1.6 (whole graph)',
      })
    )
    expect(mocks.change).toHaveBeenCalledWith(
      { sessionId: 's1', remove: ['g1'] },
      expect.anything()
    )
  })

  it('offers to create a graph when there is none', async () => {
    mocks.graphs = []
    open([])
    await userEvent.click(screen.getByRole('button', { name: 'New Graph…' }))
    expect(useUIStore.getState().linkToGraphTarget).toBeNull()
    expect(useUIStore.getState().newGraphDialogOpen).toBe(true)
  })

  it('closes with Done', async () => {
    open([])
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(useUIStore.getState().linkToGraphTarget).toBeNull()
  })
})
