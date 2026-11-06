import { describe, expect, it } from 'vitest'
import { summary } from '@/components/graphs/graph-test-fixtures'
import { collectServedGraphIds, selectProjectGraphs } from './project-graphs'

const stored = summary({ id: 'stored', title: 'Roadmap', projectId: 'p1' })
const storedB = summary({ id: 'stored-b', title: 'audit', projectId: 'p1' })
const elsewhere = summary({
  id: 'elsewhere',
  title: 'Release',
  projectId: 'p2',
  projectName: 'other',
})
const instance = summary({
  id: 'instance',
  title: 'Instance plan',
  locationKind: 'folder',
  projectId: null,
  projectName: null,
  repoRoot: null,
})
const unrelated = summary({ id: 'unrelated', title: 'Other', projectId: 'p3' })
const all = [unrelated, instance, elsewhere, stored, storedB]

const ids = (entries: ReturnType<typeof selectProjectGraphs>) =>
  entries.map(entry => [entry.graph.id, entry.served])

describe('collectServedGraphIds', () => {
  it('takes the graph id of whole-graph and node refs', () => {
    expect(
      collectServedGraphIds([
        { serves: ['elsewhere#n1', 'instance'] },
        { serves: ['elsewhere#n2'] },
        {},
      ])
    ).toEqual(new Set(['elsewhere', 'instance']))
  })

  it('ignores archived sessions', () => {
    expect(
      collectServedGraphIds([{ serves: ['elsewhere'], archived_at: 1 }])
    ).toEqual(new Set())
  })
})

describe('selectProjectGraphs', () => {
  it('lists graphs stored in the project, by title', () => {
    expect(ids(selectProjectGraphs(all, 'p1', new Set()))).toEqual([
      ['stored-b', false],
      ['stored', false],
    ])
  })

  it('lists served graphs from another project or the instance', () => {
    expect(
      ids(selectProjectGraphs(all, 'p9', new Set(['instance', 'elsewhere'])))
    ).toEqual([
      ['instance', true],
      ['elsewhere', true],
    ])
  })

  it('puts stored first, then served, and lists a stored graph once', () => {
    expect(
      ids(selectProjectGraphs(all, 'p1', new Set(['elsewhere', 'stored'])))
    ).toEqual([
      ['stored-b', false],
      ['stored', false],
      ['elsewhere', true],
    ])
  })

  it('is empty when nothing is stored or served', () => {
    expect(selectProjectGraphs(all, 'p9', new Set(['missing']))).toEqual([])
  })
})
