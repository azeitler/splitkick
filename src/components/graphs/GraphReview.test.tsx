import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import type { GraphChange, GraphRequest } from '@/types/graphs'
import { GraphReview } from './GraphReview'
import { detail, node } from './graph-test-fixtures'

const mocks = vi.hoisted(() => ({
  answer: vi.fn(),
  markSeen: vi.fn(),
  revert: vi.fn(),
  requests: [] as GraphRequest[],
}))

vi.mock('@/services/graphs', () => ({
  useGraphRequests: () => ({ data: mocks.requests }),
  useAnswerGraphRequest: () => ({ mutate: mocks.answer, isPending: false }),
  useMarkGraphChangesSeen: () => ({ mutate: mocks.markSeen, isPending: false }),
  useRevertGraphChange: () => ({ mutate: mocks.revert, isPending: false }),
}))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { agent_profiles: [] } }),
}))

const request = (extra: Partial<GraphRequest>): GraphRequest => ({
  id: 'r1',
  graphId: 'g1',
  nodeId: 'n74',
  kind: 'accept-done',
  title: 'Mermaid diagrams in chat',
  body: 'The outcome matches the node.',
  evidence: ['PR #80 merged'],
  options: [],
  blocker: null,
  fromSessionId: 's1',
  fromSessionName: 'Roadmap upkeep',
  agentId: null,
  createdAt: Date.now() - 40 * 60_000,
  status: 'open',
  answer: null,
  answeredAt: null,
  ...extra,
})

const change = (extra: Partial<GraphChange>): GraphChange => ({
  id: 'c1',
  graphId: 'g1',
  nodeId: 'n76',
  at: Date.now() - 5 * 60_000,
  actor: {
    kind: 'session',
    sessionId: 's1',
    sessionName: 'Roadmap upkeep',
    agentId: null,
  },
  action: 'node.update',
  summary: 'description edited',
  why: 'Added the prerequisite',
  before: null,
  after: null,
  revertedBy: null,
  seen: false,
  ...extra,
})

const graph = detail({
  nodes: [
    node('n74', 'Mermaid diagrams in chat'),
    node('n76', 'HTML and SVG preview'),
    node('n71', 'Windows support'),
  ],
})

function renderReview(changes: GraphChange[] = []) {
  render(
    <GraphReview
      graphId="g1"
      detail={graph}
      changes={changes}
      unseenNodeIds={new Set()}
      selectedNodeId={null}
      onSelectNode={vi.fn()}
    />
  )
}

describe('GraphReview', () => {
  beforeEach(() => {
    mocks.answer.mockClear()
    mocks.markSeen.mockClear()
    mocks.revert.mockClear()
    mocks.requests = []
  })

  it('accepts a done request', async () => {
    mocks.requests = [request({})]
    renderReview()
    expect(screen.getByText('PR #80 merged')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Accept/ }))
    expect(mocks.answer).toHaveBeenCalledWith({
      graphId: 'g1',
      requestId: 'r1',
      action: 'accept',
      answer: undefined,
    })
  })

  it('sends back only with a note', async () => {
    mocks.requests = [request({})]
    renderReview()
    await userEvent.click(
      screen.getByRole('button', { name: /Send back with/ })
    )
    const send = screen.getByRole('button', { name: 'Send back' })
    expect(send).toBeDisabled()
    await userEvent.type(
      screen.getByLabelText('Note for the session'),
      'Also the plan view'
    )
    await userEvent.click(send)
    expect(mocks.answer).toHaveBeenCalledWith({
      graphId: 'g1',
      requestId: 'r1',
      action: 'send-back',
      answer: 'Also the plan view',
    })
  })

  it('answers a decision with an option or free text', async () => {
    mocks.requests = [
      request({
        id: 'r2',
        kind: 'decision',
        title: 'Windows: 1.x or later?',
        nodeId: 'n71',
        options: ['Later (after 1.1)', 'In 1.1'],
        blocker: 'decision: ship Windows in 1.x or later?',
      }),
    ]
    renderReview()
    await userEvent.click(screen.getByRole('button', { name: 'In 1.1' }))
    expect(mocks.answer).toHaveBeenLastCalledWith({
      graphId: 'g1',
      requestId: 'r2',
      action: 'answer',
      answer: 'In 1.1',
    })
    await userEvent.click(screen.getByRole('button', { name: 'Other answer…' }))
    await userEvent.type(screen.getByLabelText('Your answer'), 'In 2.0')
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }))
    expect(mocks.answer).toHaveBeenLastCalledWith({
      graphId: 'g1',
      requestId: 'r2',
      action: 'answer',
      answer: 'In 2.0',
    })
  })

  it('shows answered requests collapsed, apart from the open ones', () => {
    mocks.requests = [
      request({ id: 'r3', status: 'accepted', answeredAt: Date.now() }),
    ]
    renderReview()
    expect(screen.queryAllByTestId('graph-request')).toHaveLength(0)
    expect(screen.getByTestId('answered-requests')).toHaveTextContent(
      'Answered (1)'
    )
  })

  it('groups unseen changes by node and marks them seen', async () => {
    renderReview([
      change({ id: 'c1' }),
      change({ id: 'c2', summary: 'state → committed' }),
      change({ id: 'c3', nodeId: 'n74' }),
      change({ id: 'c4', seen: true, summary: 'old change' }),
    ])
    const groups = screen.getAllByTestId('unseen-group')
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveTextContent('HTML and SVG preview2 changes')
    await userEvent.click(
      within(groups[0] as HTMLElement).getByRole('button', { name: /Seen/ })
    )
    expect(mocks.markSeen).toHaveBeenCalledWith({
      graphId: 'g1',
      changeIds: ['c1', 'c2'],
    })
    await userEvent.click(screen.getByRole('button', { name: /Mark all seen/ }))
    expect(mocks.markSeen).toHaveBeenLastCalledWith({ graphId: 'g1' })
    expect(screen.getByText(/old change/)).toBeInTheDocument()
  })

  it('reverts a change, and not one that is reverted already', async () => {
    renderReview([
      change({ id: 'c1', after: node('n76', 'HTML and SVG preview') }),
      change({ id: 'c2', nodeId: 'n74', revertedBy: 'c9' }),
    ])
    const rows = screen.getAllByTestId('graph-change')
    await userEvent.click(
      within(rows[0] as HTMLElement).getByRole('button', { name: /Revert/ })
    )
    expect(mocks.revert).toHaveBeenCalledWith({ graphId: 'g1', changeId: 'c1' })
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: /reverted/ })
    ).toBeDisabled()
  })

  it('offers no Revert for a change without a node snapshot', () => {
    renderReview([
      change({
        id: 'c3',
        nodeId: null,
        action: 'graph.create',
        summary: 'Created graph',
      }),
    ])
    const row = screen.getByTestId('graph-change')
    expect(within(row).queryByRole('button', { name: /Revert/ })).toBeNull()
  })

  it("shows a manager's serves change with its reason and reverts it (#88)", async () => {
    renderReview([
      change({
        id: 'c4',
        nodeId: null,
        action: 'session.serves',
        summary: 'Session "Windows worker" linked to Windows support',
        why: 'Release work moves to the node',
        serves: {
          sessionId: 's9',
          sessionName: 'Windows worker',
          added: ['g1#n71'],
          removed: [],
        },
      }),
    ])
    const row = screen.getByTestId('graph-change')
    expect(
      within(row).getByText(
        'Session "Windows worker" linked to Windows support'
      )
    ).toBeInTheDocument()
    expect(
      within(row).getByText('Release work moves to the node')
    ).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: /Revert/ }))
    expect(mocks.revert).toHaveBeenCalledWith({ graphId: 'g1', changeId: 'c4' })
  })
})
