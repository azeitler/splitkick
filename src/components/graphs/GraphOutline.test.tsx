import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import type { GraphDetail } from '@/types/graphs'
import { GraphOutline } from './GraphOutline'
import { buildOutline } from './graph-utils'
import { derived, detail, node } from './graph-test-fixtures'

const mocks = vi.hoisted(() => ({ createNode: vi.fn() }))

vi.mock('@/services/graphs', () => ({
  useCreateGraphNode: () => ({ mutate: mocks.createNode, isPending: false }),
}))

const partOf = (target: string) => [{ kind: 'part-of' as const, target }]

function roadmap(): GraphDetail {
  return detail({
    nodes: [
      node('layer', 'Graph layer'),
      node('pcs', 'Parent/child sessions', {
        state: 'done',
        relations: partOf('layer'),
        attachments: [{ kind: 'issue', value: 'azeitler/splitkick#62' }],
      }),
      node('gs1', 'Graph support v1', { relations: partOf('layer') }),
      node('loose', 'Loose idea', { state: 'proposed' }),
    ],
    derived: {
      layer: derived({ progressDone: 1, progressTotal: 2 }),
      pcs: derived(),
      gs1: derived({
        active: true,
        blocked: true,
        blockers: ['depends-on Graph layer design'],
      }),
      loose: derived(),
    },
    incoming: {
      gs1: [{ kind: 'depends-on', source: 'g2#fp1', external: true }],
    },
    external: {
      'g2#fp1': {
        ref: 'g2#fp1',
        graphId: 'g2',
        graphTitle: 'Website relaunch',
        nodeId: 'fp1',
        title: 'Feature page: Graphs',
        state: 'committed',
        found: true,
      },
    },
  })
}

function renderOutline(
  extra: { unseen?: string[]; onSelect?: () => void } = {}
) {
  const graph = roadmap()
  render(
    <GraphOutline
      graphId="g1"
      detail={graph}
      changes={[]}
      unseenNodeIds={new Set(extra.unseen ?? [])}
      selectedNodeId={null}
      onSelectNode={extra.onSelect ?? vi.fn()}
    />
  )
}

describe('buildOutline', () => {
  it('nests by part-of and keeps file order', () => {
    const outline = buildOutline(roadmap().nodes)
    expect(outline.map(i => i.node.id)).toEqual(['layer', 'loose'])
    expect(outline[0]?.children.map(i => i.node.id)).toEqual(['pcs', 'gs1'])
  })

  it('shows every node once, also in a part-of cycle', () => {
    const outline = buildOutline([
      node('a', 'A', { relations: partOf('b') }),
      node('b', 'B', { relations: partOf('a') }),
    ])
    const ids: string[] = []
    const walk = (items: typeof outline) =>
      items.forEach(i => {
        ids.push(i.node.id)
        walk(i.children)
      })
    walk(outline)
    expect(ids.sort()).toEqual(['a', 'b'])
  })

  it('treats a part-of to an unknown node as a root', () => {
    const outline = buildOutline([node('a', 'A', { relations: partOf('zz') })])
    expect(outline.map(i => i.node.id)).toEqual(['a'])
  })
})

describe('GraphOutline', () => {
  it('groups children under their part-of parent', () => {
    renderOutline()
    expect(screen.getByTestId('graph-node-row-layer')).toHaveAttribute(
      'data-depth',
      '0'
    )
    expect(screen.getByTestId('graph-node-row-gs1')).toHaveAttribute(
      'data-depth',
      '1'
    )
    expect(screen.getByTestId('graph-node-row-loose')).toHaveAttribute(
      'data-depth',
      '0'
    )
  })

  it('shows derived badges, progress and the issue number', () => {
    renderOutline({ unseen: ['gs1'] })
    const gs1 = screen.getByTestId('graph-node-row-gs1')
    expect(within(gs1).getByTestId('node-active-badge')).toBeInTheDocument()
    expect(within(gs1).getByTestId('node-blocked-badge')).toBeInTheDocument()
    expect(within(gs1).getByTestId('node-unseen-dot')).toBeInTheDocument()
    expect(within(gs1).getByTestId('node-state-chip')).toHaveTextContent(
      'committed'
    )

    expect(
      within(screen.getByTestId('graph-node-row-layer')).getByTestId(
        'node-progress'
      )
    ).toHaveTextContent('1/2 done')
    expect(screen.getByTestId('graph-node-row-pcs')).toHaveTextContent('#62')
    expect(
      within(screen.getByTestId('graph-node-row-pcs')).queryByTestId(
        'node-active-badge'
      )
    ).toBeNull()
  })

  it('shows a cross-graph row for an incoming external relation', () => {
    renderOutline()
    const row = screen.getByTestId('graph-external-row')
    expect(row).toHaveTextContent('Feature page: Graphs')
    expect(row).toHaveTextContent('Website relaunch')
    expect(row).toHaveTextContent('depends on Graph support v1')
  })

  it('collapses a parent', async () => {
    renderOutline()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByTestId('graph-node-row-gs1')).toBeNull()
  })

  it('selects a node on click', async () => {
    const onSelect = vi.fn()
    renderOutline({ onSelect })
    await userEvent.click(screen.getByTestId('graph-node-row-gs1'))
    expect(onSelect).toHaveBeenCalledWith('gs1')
  })

  it('adds a node under a parent', async () => {
    renderOutline()
    await userEvent.click(screen.getByRole('button', { name: /Add node/ }))
    await userEvent.type(screen.getByLabelText('New node title'), 'Docs')
    await userEvent.selectOptions(screen.getByLabelText('Parent node'), 'layer')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(mocks.createNode).toHaveBeenCalledWith(
      {
        graphId: 'g1',
        node: {
          title: 'Docs',
          relations: [{ kind: 'part-of', target: 'layer' }],
        },
      },
      expect.anything()
    )
  })
})
