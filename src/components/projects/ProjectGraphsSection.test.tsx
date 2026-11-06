import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { summary } from '@/components/graphs/graph-test-fixtures'
import { getCurrentUIState } from '@/lib/ui-state-snapshot'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { GraphSummary } from '@/types/graphs'
import { ProjectGraphsSection } from './ProjectGraphsSection'

const mocks = vi.hoisted(() => ({
  graphs: [] as GraphSummary[],
  openGraphView: vi.fn(),
}))

vi.mock('@/services/graphs', () => ({
  useGraphs: () => ({ data: mocks.graphs }),
}))
vi.mock('@/lib/graph-view', () => ({ openGraphView: mocks.openGraphView }))
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
  isMobileViewport: () => false,
}))

const stored = summary({
  id: 'stored',
  title: 'Roadmap',
  projectId: 'p1',
  openRequests: 2,
  unseenChanges: 3,
})
const served = summary({
  id: 'served',
  title: 'Release',
  projectId: 'p2',
  projectName: 'website',
})

const renderSection = (servedIds: string[] = []) =>
  render(
    <ProjectGraphsSection projectId="p1" servedGraphIds={new Set(servedIds)} />
  )

describe('ProjectGraphsSection', () => {
  beforeEach(() => {
    mocks.graphs = [served, stored]
    mocks.openGraphView.mockClear()
    useProjectsStore.setState({ expandedGraphsProjectIds: new Set() })
    useUIStore.setState({ activeGraphId: null })
  })

  it('is hidden when the project has no relevant graphs', () => {
    mocks.graphs = [served]
    const { container } = renderSection()
    expect(container).toBeEmptyDOMElement()
  })

  it('starts collapsed with a count, and keeps the toggle per project', async () => {
    const user = userEvent.setup()
    renderSection(['served'])
    const toggle = screen.getByTestId('project-graphs-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Graphs')
    expect(toggle).toHaveTextContent('2')
    expect(screen.queryByTestId('project-graphs-list')).toBeNull()

    await user.click(toggle)
    expect(screen.getByTestId('project-graphs-list')).toBeInTheDocument()
    expect(useProjectsStore.getState().expandedGraphsProjectIds).toEqual(
      new Set(['p1'])
    )
    // Saved with the UI state, like the Pinned row.
    expect(getCurrentUIState().expanded_graphs_project_ids).toEqual(['p1'])

    await user.click(toggle)
    expect(screen.queryByTestId('project-graphs-list')).toBeNull()
  })

  it('lists stored before served, with badges and the served marker', () => {
    useProjectsStore.setState({ expandedGraphsProjectIds: new Set(['p1']) })
    renderSection(['served'])
    const rows = screen.getAllByTestId(/^project-graph-row-/)
    expect(rows.map(row => row.dataset.testid)).toEqual([
      'project-graph-row-stored',
      'project-graph-row-served',
    ])
    expect(rows[0]).not.toHaveAttribute('data-served')
    expect(rows[0]).toHaveTextContent('roadmap')
    expect(
      screen
        .getByTestId('project-graph-row-stored')
        .querySelector('[data-testid="sidebar-graph-requests"]')
    ).toHaveTextContent('2')
    expect(
      rows[0]?.querySelector('[data-testid="sidebar-graph-unseen"]')
    ).toHaveTextContent('3')
    expect(rows[1]).toHaveAttribute('data-served')
    expect(rows[1]).toHaveTextContent('from website')
    expect(rows[1]).toHaveAttribute(
      'title',
      'Release — roadmap · served from website repo'
    )
  })

  it('opens the graph and highlights the open one', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({ expandedGraphsProjectIds: new Set(['p1']) })
    useUIStore.setState({ activeGraphId: 'served' })
    renderSection(['served'])
    expect(screen.getByTestId('project-graph-row-served')).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByTestId('project-graph-row-stored')).not.toHaveAttribute(
      'aria-current'
    )

    await user.click(screen.getByTestId('project-graph-row-stored'))
    expect(mocks.openGraphView).toHaveBeenCalledWith('stored')
  })

  it('canvas variant is always open, without a toggle', async () => {
    const user = userEvent.setup()
    render(
      <ProjectGraphsSection
        projectId="p1"
        servedGraphIds={new Set(['served'])}
        variant="canvas"
      />
    )
    expect(screen.queryByTestId('project-graphs-toggle')).toBeNull()
    expect(screen.getAllByTestId(/^project-graph-row-/)).toHaveLength(2)
    await user.click(screen.getByTestId('project-graph-row-served'))
    expect(mocks.openGraphView).toHaveBeenCalledWith('served')
  })

  it('canvas variant is hidden when nothing is relevant', () => {
    mocks.graphs = [served]
    const { container } = render(
      <ProjectGraphsSection
        projectId="p1"
        servedGraphIds={new Set()}
        variant="canvas"
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
