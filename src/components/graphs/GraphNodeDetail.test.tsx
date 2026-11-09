import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import type { GraphChange, GraphRequest } from '@/types/graphs'
import { GraphNodeDetail } from './GraphNodeDetail'
import { derived, detail, node } from './graph-test-fixtures'

const mocks = vi.hoisted(() => ({
  updateNode: vi.fn(),
  markSeen: vi.fn(),
  deleteNode: vi.fn(),
  navigateToSession: vi.fn(),
  requests: [] as Partial<GraphRequest>[],
}))

vi.mock('@/services/graphs', () => ({
  useUpdateGraphNode: () => ({ mutate: mocks.updateNode }),
  useMarkGraphChangesSeen: () => ({ mutate: mocks.markSeen }),
  useDeleteGraphNode: () => ({ mutate: mocks.deleteNode }),
  useGraphRequests: () => ({ data: mocks.requests }),
}))
vi.mock('@/lib/navigate-to-session', () => ({
  navigateToSession: mocks.navigateToSession,
}))

const graph = detail({
  nodes: [
    node('gs1', 'Graph support v1', {
      description: 'Graph store in jean-core',
      properties: [['quarter', '2027-Q1']],
      relations: [
        { kind: 'depends-on', target: 'gld' },
        { kind: 'blocked-by', target: 'decision: storage' },
      ],
      attachments: [{ kind: 'issue', value: 'azeitler/splitkick#78' }],
    }),
    node('gld', 'Graph layer design'),
    node('docs', 'Docs guide', {
      relations: [{ kind: 'depends-on', target: 'gs1' }],
    }),
  ],
  derived: {
    gs1: derived({
      blocked: true,
      blockers: [
        'depends-on Graph layer design',
        'blocked-by decision: storage',
      ],
      serving: [
        {
          sessionId: 's1',
          sessionName: 'Roadmap upkeep',
          projectId: 'p1',
          worktreeId: 'w1',
          worktreeName: 'base',
          status: 'running',
          agentId: null,
        },
      ],
    }),
  },
  incoming: { gs1: [{ kind: 'depends-on', source: 'docs', external: false }] },
})

const change = (extra: Partial<GraphChange>): GraphChange => ({
  id: 'c1',
  graphId: 'g1',
  nodeId: 'gs1',
  at: Date.now() - 12 * 60_000,
  actor: {
    kind: 'session',
    sessionId: 's1',
    sessionName: 'Roadmap upkeep',
    agentId: null,
  },
  action: 'node.update',
  summary: 'property quarter: 2026-Q4 → 2027-Q1',
  why: 'Storage decision is open',
  before: null,
  after: null,
  revertedBy: null,
  seen: false,
  ...extra,
})

const handlers = { onSelectNode: vi.fn(), onOpenReview: vi.fn() }

function renderDetail(changes: GraphChange[] = [], data = graph) {
  render(
    <GraphNodeDetail
      graphId="g1"
      detail={data}
      nodeId="gs1"
      changes={changes}
      onClose={vi.fn()}
      {...handlers}
    />
  )
}

beforeEach(() => {
  mocks.updateNode.mockClear()
  mocks.markSeen.mockClear()
  mocks.navigateToSession.mockClear()
  handlers.onSelectNode.mockClear()
  handlers.onOpenReview.mockClear()
  mocks.requests = []
  useProjectsStore.getState().setGraphDetailsShown(false)
  useProjectsStore.getState().setGraphRelationsShown(false)
})

describe('GraphNodeDetail simple layer', () => {
  it('hides the expert layer until "Show details", and remembers it', async () => {
    renderDetail()
    expect(screen.queryByTestId('graph-node-expert')).not.toBeInTheDocument()
    expect(screen.queryByText(/id gs1/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByTestId('graph-node-expert')).toBeInTheDocument()
    expect(useProjectsStore.getState().graphDetailsShown).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Hide details' }))
    expect(screen.queryByTestId('graph-node-expert')).not.toBeInTheDocument()
  })

  it('changes the state with plain words', async () => {
    renderDetail()
    expect(screen.getByRole('radio', { name: 'Planned' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Done' }))
    expect(mocks.updateNode).toHaveBeenCalledWith({
      graphId: 'g1',
      nodeId: 'gs1',
      patch: { state: 'done' },
    })
  })

  it('says what the node waits for and links the node', async () => {
    renderDetail()
    const waiting = screen.getByTestId('graph-waiting-for')
    expect(waiting).toHaveTextContent('Waiting for')
    expect(waiting).toHaveTextContent('a decision: storage')
    await userEvent.click(
      screen.getByRole('button', { name: 'Graph layer design' })
    )
    expect(handlers.onSelectNode).toHaveBeenCalledWith('gld')
  })

  it('points to Review when a request for the node is open', async () => {
    mocks.requests = [
      { id: 'r1', nodeId: 'gs1', status: 'open' },
      { id: 'r2', nodeId: 'gs1', status: 'answered' },
      { id: 'r3', nodeId: 'docs', status: 'open' },
    ]
    renderDetail()
    await userEvent.click(screen.getByText('1 request waits for you'))
    expect(handlers.onOpenReview).toHaveBeenCalled()
  })

  it('offers "Add description" instead of an empty box', async () => {
    render(
      <GraphNodeDetail
        graphId="g1"
        detail={graph}
        nodeId="gld"
        changes={[]}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Add description' })
    )
    await userEvent.type(screen.getByLabelText('Description'), 'Spec first')
    await userEvent.click(document.body)
    expect(mocks.updateNode).toHaveBeenCalledWith({
      graphId: 'g1',
      nodeId: 'gld',
      patch: { description: 'Spec first' },
    })
  })

  it('opens a serving session', async () => {
    renderDetail()
    await userEvent.click(screen.getByText('Roadmap upkeep'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's1',
    })
  })
})

describe('GraphNodeDetail Relationships foldout', () => {
  it('is closed by default and separate from the details', async () => {
    renderDetail()
    const toggle = screen.getByTestId('graph-relations-toggle')
    // 2 stored relations + 1 incoming
    expect(toggle).toHaveTextContent('Relationships(3)')
    expect(screen.queryByTestId('graph-node-relations')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.queryByTestId('graph-node-relations')).toBeNull()
    await userEvent.click(toggle)
    expect(screen.getByTestId('graph-node-relations')).toBeInTheDocument()
    expect(useProjectsStore.getState().graphRelationsShown).toBe(true)
  })

  it('sits above "Show details"', () => {
    renderDetail()
    const relations = screen.getByTestId('graph-relations-toggle')
    const details = screen.getByTestId('graph-details-toggle')
    expect(
      relations.compareDocumentPosition(details) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

describe('GraphNodeDetail expert layer and relations', () => {
  beforeEach(() => {
    useProjectsStore.getState().setGraphDetailsShown(true)
    useProjectsStore.getState().setGraphRelationsShown(true)
  })

  it('shows stored and computed relations with the file words', () => {
    renderDetail()
    const relations = screen.getAllByTestId('graph-relation')
    expect(relations).toHaveLength(2)
    expect(relations[0]).toHaveTextContent('depends-onGraph layer design')
    expect(relations[1]).toHaveTextContent('blocked-bydecision: storage')
    expect(screen.getByTestId('graph-incoming')).toHaveTextContent(
      'needed byDocs guide'
    )
    expect(screen.getByText(/id gs1/)).toHaveTextContent('state committed')
  })

  it('renders the description as Markdown', () => {
    renderDetail(
      [],
      detail({
        nodes: [
          node('gs1', 'Graph support v1', {
            description: '**Bold** and ![shot](docs/a.png)',
          }),
        ],
      })
    )
    expect(screen.getByText('Bold').tagName).toBe('STRONG')
    expect(screen.getByAltText('shot')).toBeInTheDocument()
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument()
  })

  it('renders an issue attachment as a link', () => {
    renderDetail()
    expect(
      screen.getByRole('link', { name: 'azeitler/splitkick#78' })
    ).toHaveAttribute('href', 'https://github.com/azeitler/splitkick/issues/78')
  })

  it('removes a relation by replacing the list', async () => {
    renderDetail()
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Remove blocked-by decision: storage',
      })
    )
    expect(mocks.updateNode).toHaveBeenCalledWith({
      graphId: 'g1',
      nodeId: 'gs1',
      patch: { relations: [{ kind: 'depends-on', target: 'gld' }] },
    })
  })

  it('adds a property', async () => {
    renderDetail()
    await userEvent.type(screen.getByLabelText('New property key'), 'size')
    await userEvent.type(screen.getByLabelText('New property value'), 'L')
    await userEvent.click(screen.getByRole('button', { name: 'Add property' }))
    expect(mocks.updateNode).toHaveBeenCalledWith({
      graphId: 'g1',
      nodeId: 'gs1',
      patch: {
        properties: [
          ['quarter', '2027-Q1'],
          ['size', 'L'],
        ],
      },
    })
  })

  it('replaces the value of an existing key in place', async () => {
    renderDetail()
    await userEvent.type(screen.getByLabelText('New property key'), 'quarter')
    await userEvent.type(
      screen.getByLabelText('New property value'),
      '2027-Q2{Enter}'
    )
    expect(mocks.updateNode).toHaveBeenCalledWith({
      graphId: 'g1',
      nodeId: 'gs1',
      patch: { properties: [['quarter', '2027-Q2']] },
    })
  })

  it('Escape restores the description and a property value', async () => {
    renderDetail()
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit description' })
    )
    const description = screen.getByLabelText('Description')
    await userEvent.clear(description)
    await userEvent.type(description, 'Draft{Escape}')
    expect(description).toHaveValue('Graph store in jean-core')
    const property = screen.getByLabelText('Property quarter')
    await userEvent.clear(property)
    await userEvent.type(property, 'XL{Escape}')
    expect(property).toHaveValue('2027-Q1')
    await userEvent.click(document.body)
    expect(mocks.updateNode).not.toHaveBeenCalled()
  })

  it('marks a cross-graph target that does not exist', () => {
    render(
      <GraphNodeDetail
        graphId="g1"
        detail={detail({
          nodes: [
            node('a1', 'A', {
              relations: [
                { kind: 'depends-on', target: 'g2#gone00' },
                { kind: 'relates-to', target: 'g2#here00' },
              ],
            }),
          ],
          external: {
            'g2#gone00': {
              ref: 'g2#gone00',
              graphId: 'g2',
              graphTitle: 'Other',
              nodeId: 'gone00',
              title: null,
              state: null,
              found: false,
            },
            'g2#here00': {
              ref: 'g2#here00',
              graphId: 'g2',
              graphTitle: 'Other',
              nodeId: 'here00',
              title: 'Here',
              state: 'proposed',
              found: true,
            },
          },
        })}
        nodeId="a1"
        changes={[]}
        onClose={vi.fn()}
      />
    )
    const [gone, here] = screen.getAllByTestId('graph-relation')
    expect(gone).toHaveTextContent('g2#gone00↗ Othernot found')
    expect(here).not.toHaveTextContent('not found')
  })

  it('shows the node history with who, when and why, and marks it seen', () => {
    renderDetail([change({})])
    const history = screen.getByTestId('graph-node-history')
    expect(history).toHaveTextContent('Roadmap upkeep')
    expect(history).toHaveTextContent('12m ago')
    expect(history).toHaveTextContent('Why: Storage decision is open')
    expect(mocks.markSeen).toHaveBeenCalledWith({
      graphId: 'g1',
      changeIds: ['c1'],
    })
  })
})
