import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { summary } from '@/components/graphs/graph-test-fixtures'
import { useUIStore } from '@/store/ui-store'
import type { GraphSummary } from '@/types/graphs'
import { SidebarGraphsSection } from './SidebarGraphsSection'

const mocks = vi.hoisted(() => ({
  graphs: [] as GraphSummary[],
  openGraphView: vi.fn(),
}))

vi.mock('@/services/graphs', () => ({
  useGraphs: () => ({ data: mocks.graphs }),
}))
vi.mock('@/lib/graph-view', () => ({ openGraphView: mocks.openGraphView }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
// The dialog has its own test.
vi.mock('@/components/graphs/NewGraphDialog', () => ({
  NewGraphDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="new-graph-dialog" /> : null,
}))

describe('SidebarGraphsSection', () => {
  beforeEach(() => {
    mocks.graphs = []
    mocks.openGraphView.mockClear()
    useUIStore.setState({ activeGraphId: null })
  })

  it('shows an empty state and New without graphs', async () => {
    render(<SidebarGraphsSection />)
    expect(screen.getByTestId('sidebar-graphs-empty')).toHaveTextContent(
      'No graphs yet'
    )
    expect(screen.queryByTestId(/^sidebar-graph-row-/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'New graph' }))
    expect(screen.getByTestId('new-graph-dialog')).toBeInTheDocument()
  })

  it('lists graphs with type, where, counts and warnings', () => {
    mocks.graphs = [
      summary({ id: 'g1', openRequests: 3, unseenChanges: 2 }),
      summary({
        id: 'g2',
        title: 'Docs plan',
        graphType: 'docs',
        locationKind: 'other-repo',
        repoRoot: '/Users/me/roadmaps',
        projectName: null,
      }),
      summary({
        id: 'g3',
        title: 'Portfolio',
        graphType: 'portfolio',
        locationKind: 'folder',
        path: '/Users/me/Graphs/portfolio.yml',
        repoRoot: null,
        missing: true,
      }),
    ]
    render(<SidebarGraphsSection />)

    const first = screen.getByTestId('sidebar-graph-row-g1')
    expect(first).toHaveTextContent('Splitkick roadmap')
    expect(first).toHaveTextContent('roadmap · splitkick repo')
    expect(
      within(first).getByTestId('sidebar-graph-requests')
    ).toHaveTextContent('3')
    expect(within(first).getByTestId('sidebar-graph-unseen')).toHaveTextContent(
      '2'
    )
    expect(within(first).queryByTestId('sidebar-graph-warning')).toBeNull()

    expect(screen.getByTestId('sidebar-graph-row-g2')).toHaveTextContent(
      'docs · roadmaps repo'
    )
    const third = screen.getByTestId('sidebar-graph-row-g3')
    expect(third).toHaveTextContent('portfolio · ~/Graphs')
    expect(
      within(third).getByTestId('sidebar-graph-warning')
    ).toBeInTheDocument()
  })

  it('warns when the checkout is off the default branch', () => {
    mocks.graphs = [
      summary({
        offDefaultBranch: true,
        branch: 'feature',
        defaultBranch: 'main',
      }),
    ]
    render(<SidebarGraphsSection />)
    expect(screen.getByTestId('sidebar-graph-warning')).toHaveAttribute(
      'title',
      'Checkout is on feature, not main'
    )
  })

  it('opens a graph and marks the active one', async () => {
    mocks.graphs = [summary({ id: 'g1' }), summary({ id: 'g2', title: 'B' })]
    useUIStore.setState({ activeGraphId: 'g2' })
    render(<SidebarGraphsSection />)

    expect(screen.getByTestId('sidebar-graph-row-g2')).toHaveAttribute(
      'aria-current',
      'page'
    )
    await userEvent.click(screen.getByTestId('sidebar-graph-row-g1'))
    expect(mocks.openGraphView).toHaveBeenCalledWith('g1')
  })
})
