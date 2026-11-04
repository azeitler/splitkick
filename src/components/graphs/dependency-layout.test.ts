import { describe, expect, it } from 'vitest'
import { buildDependencyLayout, dependencySteps } from './dependency-layout'
import { derived, detail, node } from './graph-test-fixtures'

const graph = detail({
  nodes: [
    node('grp', 'Graph layer'),
    node('pcs', 'Parent/child sessions', {
      state: 'done',
      relations: [{ kind: 'part-of', target: 'grp' }],
    }),
    node('gld', 'Graph layer design', {
      relations: [
        { kind: 'part-of', target: 'grp' },
        { kind: 'depends-on', target: 'pcs' },
      ],
    }),
    node('gs1', 'Graph support v1', {
      relations: [
        { kind: 'part-of', target: 'grp' },
        { kind: 'depends-on', target: 'gld' },
        { kind: 'blocked-by', target: 'storage for multi-machine sync' },
        { kind: 'relates-to', target: 'web#fp1' },
      ],
    }),
    node('solo', 'Release notes', {
      relations: [{ kind: 'depends-on', target: 'gs1' }],
    }),
  ],
  derived: { grp: derived({ progressDone: 1, progressTotal: 3 }) },
  external: {
    'web#fp1': {
      ref: 'web#fp1',
      graphId: 'web',
      graphTitle: 'Website relaunch',
      nodeId: 'fp1',
      title: 'Feature page: Graphs',
      state: 'committed',
      found: true,
    },
  },
})

describe('dependencySteps', () => {
  it('is the longest depends-on path', () => {
    const steps = dependencySteps(graph.nodes)
    expect(steps.get('pcs')).toBe(0)
    expect(steps.get('gld')).toBe(1)
    expect(steps.get('gs1')).toBe(2)
    expect(steps.get('solo')).toBe(3)
  })

  it('ends on a cycle', () => {
    const steps = dependencySteps([
      node('a', 'A', { relations: [{ kind: 'depends-on', target: 'b' }] }),
      node('b', 'B', { relations: [{ kind: 'depends-on', target: 'a' }] }),
    ])
    expect(steps.size).toBe(2)
  })
})

describe('buildDependencyLayout', () => {
  const layout = buildDependencyLayout(graph)

  it('makes lanes from part-of groups, then No group and Other graphs', () => {
    expect(layout.lanes.map(l => l.title)).toEqual([
      'Graph layer',
      'No group',
      'Other graphs',
    ])
    expect(layout.lanes[0]).toMatchObject({ progressDone: 1, progressTotal: 3 })
  })

  it('puts bars in step columns after the decision column', () => {
    const column = (key: string) => layout.bars.find(b => b.key === key)?.column
    expect(layout.bars.some(b => b.key === 'grp')).toBe(false)
    expect(column('pcs')).toBe(1)
    expect(column('gld')).toBe(2)
    expect(column('gs1')).toBe(3)
    expect(column('solo')).toBe(4)
    expect(layout.columns).toBe(5)
    expect(layout.bars.find(b => b.key === 'solo')?.lane).toBe(1)
  })

  it('lists free-text blocked-by as open decisions in the lane', () => {
    expect(layout.decisions).toEqual([
      expect.objectContaining({
        text: 'storage for multi-machine sync',
        nodeId: 'gs1',
        lane: 0,
      }),
    ])
  })

  it('draws depends-on from the target, grey when it is done', () => {
    const edge = (from: string, to: string) =>
      layout.edges.find(e => e.from === from && e.to === to)
    expect(edge('pcs', 'gld')).toMatchObject({ kind: 'depends-on', done: true })
    expect(edge('gld', 'gs1')).toMatchObject({
      kind: 'depends-on',
      done: false,
    })
    expect(edge('gs1', 'web#fp1')).toMatchObject({ kind: 'relates-to' })
  })

  it('places an external node in Other graphs under its link', () => {
    const external = layout.bars.find(b => b.key === 'web#fp1')
    expect(external).toMatchObject({
      lane: 2,
      column: 3,
      graphTitle: 'Website relaunch',
      title: 'Feature page: Graphs',
    })
  })
})
