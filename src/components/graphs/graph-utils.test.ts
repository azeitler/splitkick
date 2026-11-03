import { describe, expect, it } from 'vitest'
import { graphSubtitle } from './graph-utils'
import type { GraphSummary } from '@/types/graphs'

const summary = (patch: Partial<GraphSummary>): GraphSummary => ({
  id: 'g',
  title: 'G',
  graphType: 'roadmap',
  path: '/srv/graphs/g.yml',
  locationKind: 'folder',
  repoRoot: null,
  projectId: null,
  projectName: null,
  branch: null,
  defaultBranch: null,
  offDefaultBranch: false,
  missing: false,
  error: null,
  nodeCount: 0,
  unseenChanges: 0,
  openRequests: 0,
  ...patch,
})

describe('graphSubtitle', () => {
  it('reads "type · where"', () => {
    expect(graphSubtitle(summary({}))).toBe('roadmap · /srv/graphs')
    expect(
      graphSubtitle(
        summary({
          locationKind: 'project-repo',
          projectName: 'alpha',
          repoRoot: '/srv/alpha',
        })
      )
    ).toBe('roadmap · alpha repo')
  })

  it('drops the dot when the file has no type (unreadable or hand-written)', () => {
    expect(graphSubtitle(summary({ graphType: '' }))).toBe('/srv/graphs')
  })
})
