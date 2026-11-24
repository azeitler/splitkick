import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import type { AllSessionsEntry, Session } from '@/types/chat'
import type { GraphSummary } from '@/types/graphs'
import { isSidebarTab } from '@/types/ui-state'
import { TAB_META, useSidebarTabCounts } from './tab-meta'

const mocks = vi.hoisted(() => ({
  entries: [] as AllSessionsEntry[],
  graphs: [] as Partial<GraphSummary>[],
}))

vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({ data: { entries: mocks.entries } }),
}))
vi.mock('@/services/graphs', () => ({
  useGraphs: () => ({ data: mocks.graphs }),
}))

describe('TAB_META', () => {
  it('gives Projects an open-folder icon', () => {
    const { container } = render(<>{TAB_META.projects.icon}</>)
    expect(container.querySelector('svg')).toHaveClass('lucide-folder-open')
  })
})

describe('useSidebarTabCounts', () => {
  beforeEach(() => {
    mocks.entries = []
    mocks.graphs = []
    useProjectsStore.setState({ starredSessions: [] })
  })

  it('counts To-Do and starred sessions and graph requests', () => {
    mocks.entries = [
      {
        project_id: 'p1',
        project_name: 'Acme',
        worktree_id: 'w1',
        worktree_name: 'main',
        worktree_path: '/tmp/acme',
        sessions: [
          { id: 's1', name: 'One', todo_at: 10 },
          { id: 's2', name: 'Two', todo_at: 20 },
          { id: 's3', name: 'Three' },
        ] as Session[],
      } as AllSessionsEntry,
    ]
    mocks.graphs = [
      { id: 'g1', openRequests: 2 },
      { id: 'g2', openRequests: 1 },
    ]
    useProjectsStore.setState({
      starredSessions: [{ sessionId: 's3', projectId: 'p1', worktreeId: 'w1' }],
    })

    const { result } = renderHook(() => useSidebarTabCounts())
    expect(result.current).toEqual({ starred: 1, todo: 2, graphs: 3 })
  })
})

describe('isSidebarTab', () => {
  it('accepts every tab and rejects an unknown stored value', () => {
    for (const id of [
      'projects',
      'recent',
      'starred',
      'agents',
      'todo',
      'graphs',
    ]) {
      expect(isSidebarTab(id)).toBe(true)
    }
    expect(isSidebarTab('pinned')).toBe(false)
    expect(isSidebarTab(null)).toBe(false)
  })
})
