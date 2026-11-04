import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import type { GraphChange } from '@/types/graphs'
import { GraphNodeDetail } from './GraphNodeDetail'
import { derived, detail, node } from './graph-test-fixtures'

const mocks = vi.hoisted(() => ({
  updateNode: vi.fn(),
  markSeen: vi.fn(),
  deleteNode: vi.fn(),
  navigateToSession: vi.fn(),
}))

vi.mock('@/services/graphs', () => ({
  useUpdateGraphNode: () => ({ mutate: mocks.updateNode }),
  useMarkGraphChangesSeen: () => ({ mutate: mocks.markSeen }),
  useDeleteGraphNode: () => ({ mutate: mocks.deleteNode }),
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

function renderDetail(changes: GraphChange[] = []) {
  render(
    <GraphNodeDetail
      graphId="g1"
      detail={graph}
      nodeId="gs1"
      changes={changes}
      onClose={vi.fn()}
    />
  )
}

describe('GraphNodeDetail', () => {
  beforeEach(() => {
    mocks.updateNode.mockClear()
    mocks.markSeen.mockClear()
    mocks.navigateToSession.mockClear()
  })

  it('changes the state through update_graph_node', async () => {
    renderDetail()
    await userEvent.click(screen.getByRole('radio', { name: 'done' }))
    expect(mocks.updateNode).toHaveBeenCalledWith({
      graphId: 'g1',
      nodeId: 'gs1',
      patch: { state: 'done' },
    })
  })

  it('shows stored and computed relations and the derived blockers', () => {
    renderDetail()
    const relations = screen.getAllByTestId('graph-relation')
    expect(relations).toHaveLength(2)
    expect(relations[0]).toHaveTextContent('depends-onGraph layer design')
    expect(relations[1]).toHaveTextContent('blocked-bydecision: storage')
    expect(screen.getByTestId('graph-incoming')).toHaveTextContent(
      'needed byDocs guide'
    )
    expect(screen.getByText(/Derived blocked:/)).toHaveTextContent(
      'depends-on Graph layer design; blocked-by decision: storage'
    )
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

  it('opens a serving session', async () => {
    renderDetail()
    await userEvent.click(screen.getByText('Roadmap upkeep'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's1',
    })
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
