import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { SessionGraphPanel, sessionHasGraphPanel } from './SessionGraphPanel'
import { derived, detail, node } from './graph-test-fixtures'

const mocks = vi.hoisted(() => ({
  setServes: vi.fn(),
  changeServes: vi.fn(),
  setPermission: vi.fn(),
  openGraphView: vi.fn(),
}))

const serving = (sessionId: string, sessionName: string) => ({
  sessionId,
  sessionName,
  projectId: 'p1',
  worktreeId: 'w1',
  worktreeName: 'issue-77',
  status: 'running',
  agentId: null,
})

const graph = detail({
  nodes: [
    node('grp', 'Graph layer'),
    node('pcs', 'Parent/child sessions', {
      state: 'done',
      relations: [{ kind: 'part-of', target: 'grp' }],
    }),
    node('n77', 'Session network view', {
      description: 'Show sessions as a network.',
      relations: [
        { kind: 'part-of', target: 'grp' },
        { kind: 'depends-on', target: 'pcs' },
      ],
      attachments: [{ kind: 'issue', value: 'azeitler/splitkick#77' }],
    }),
    node('gs1', 'Graph support v1', {
      relations: [{ kind: 'part-of', target: 'grp' }],
    }),
  ],
  derived: {
    n77: derived({
      active: true,
      serving: [serving('me', 'Network view'), serving('s2', 'Other one')],
    }),
    grp: derived({ progressDone: 1, progressTotal: 3 }),
  },
  incoming: {
    n77: [
      { kind: 'depends-on', source: 'gs1', external: false },
      { kind: 'part-of', source: 'x', external: false },
    ],
  },
})

vi.mock('@/services/graphs', () => ({
  useGraph: () => ({ data: graph }),
  useGraphs: () => ({ data: [{ id: 'g1', title: 'Splitkick roadmap' }] }),
  useGraphChanges: () => ({ data: [] }),
  useGraphRequests: () => ({ data: [] }),
  useSetSessionServes: () => ({ mutate: mocks.setServes }),
  useChangeSessionServes: () => ({
    mutate: mocks.changeServes,
    isPending: false,
  }),
  useSetSessionGraphPermission: () => ({ mutate: mocks.setPermission }),
}))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { agent_profiles: [] } }),
}))
vi.mock('@/lib/graph-view', () => ({ openGraphView: mocks.openGraphView }))
vi.mock('@/lib/navigate-to-session', () => ({ navigateToSession: vi.fn() }))

const worker = {
  id: 'me',
  name: 'Network view',
  serves: ['g1#n77'],
  agent_id: null,
  graph_permission: 'read',
}

describe('SessionGraphPanel', () => {
  beforeEach(() => {
    mocks.setServes.mockClear()
    mocks.changeServes.mockClear()
    mocks.setPermission.mockClear()
    mocks.openGraphView.mockClear()
  })

  it('is only for sessions that serve something or have an agent', () => {
    expect(sessionHasGraphPanel(worker)).toBe(true)
    expect(
      sessionHasGraphPanel({ ...worker, serves: [], agent_id: 'a1' })
    ).toBe(true)
    expect(sessionHasGraphPanel({ ...worker, serves: [] })).toBe(false)
    expect(sessionHasGraphPanel(null)).toBe(false)
  })

  it('shows the node card of a worker and opens it in the graph', async () => {
    render(<SessionGraphPanel session={worker} />)
    const card = screen.getByTestId('session-graph-node-card')
    expect(card).toHaveTextContent('Session network view')
    expect(card).toHaveTextContent('#77')
    expect(within(card).getByTestId('node-active-badge')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Open in graph/ }))
    expect(mocks.openGraphView).toHaveBeenCalledWith('g1', 'n77')
  })

  it('lists before/after and the siblings with this session marked', () => {
    render(<SessionGraphPanel session={worker} />)
    expect(screen.getByText('depends on')).toBeInTheDocument()
    expect(screen.getByText('needed by')).toBeInTheDocument()
    const siblings = screen.getByTestId('graph-siblings')
    const rows = within(siblings).getAllByRole('listitem')
    expect(rows.map(r => r.textContent)).toEqual([
      'Parent/child sessions',
      'Session network viewthis session',
      'Graph support v1',
    ])
  })

  it('lists other sessions on the node, not itself', () => {
    render(<SessionGraphPanel session={worker} />)
    expect(screen.getByText('Other one')).toBeInTheDocument()
    expect(screen.queryByText('Network view')).toBeNull()
  })

  it('removes a link in the Serves section without replacing the list', async () => {
    render(<SessionGraphPanel session={worker} />)
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Stop serving Splitkick roadmap › Session network view',
      })
    )
    expect(mocks.changeServes).toHaveBeenCalledWith(
      { sessionId: 'me', remove: ['g1#n77'] },
      expect.anything()
    )
  })

  it('changes the node and the permission', async () => {
    render(<SessionGraphPanel session={worker} />)
    await userEvent.selectOptions(
      screen.getByLabelText('Change node'),
      'Graph support v1'
    )
    expect(mocks.setServes).toHaveBeenCalledWith({
      sessionId: 'me',
      serves: ['g1#gs1'],
    })
    await userEvent.selectOptions(
      screen.getByLabelText('Graph permission'),
      'write'
    )
    expect(mocks.setPermission).toHaveBeenCalledWith({
      sessionId: 'me',
      permission: 'write',
    })
  })
})
