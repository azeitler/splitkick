import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutoArchiveOnMerge } from './useAutoArchiveOnMerge'
import { projectsQueryKeys } from '@/services/projects'
import type { PrStatusEvent } from '@/types/pr-status'
import type { Project, Worktree } from '@/types/projects'

const { mockInvoke, mockUsePrStatusEvents, mockToastSuccess } = vi.hoisted(
  () => ({
    mockInvoke: vi.fn().mockResolvedValue(undefined),
    mockUsePrStatusEvents: vi.fn(),
    mockToastSuccess: vi.fn(),
  })
)

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      auto_archive_on_pr_merged: true,
      removal_behavior: 'archive',
    },
  }),
}))

vi.mock('@/services/pr-status', () => ({
  usePrStatusEvents: mockUsePrStatusEvents,
}))

vi.mock('@/services/projects', async () => {
  const actual = await vi.importActual('@/services/projects')
  return {
    ...actual,
    isTauri: () => true,
  }
})

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
  },
}))

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'jean',
    path: '/repo/jean',
    default_branch: 'main',
    added_at: 1,
    order: 0,
    ...overrides,
  }
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'worktree-1',
    project_id: 'project-1',
    name: 'feature-session',
    path: '/repo/jean-worktree',
    branch: 'feature-session',
    created_at: 1,
    pr_number: 42,
    pr_url: 'https://github.com/owner/repo/pull/42',
    order: 0,
    ...overrides,
  }
}

function makeMergedPrStatus(worktreeId: string): PrStatusEvent {
  return {
    worktree_id: worktreeId,
    pr_number: 42,
    pr_url: 'https://github.com/owner/repo/pull/42',
    state: 'merged',
    is_draft: false,
    review_decision: null,
    check_status: 'success',
    display_status: 'merged',
    mergeable: null,
    head_ref_oid: 'abc123',
    checked_at: 1,
  }
}

function setup(worktree: Worktree, project = makeProject()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  queryClient.setQueryData(projectsQueryKeys.list(), [project])
  queryClient.setQueryData(projectsQueryKeys.worktrees(project.id), [worktree])

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  renderHook(() => useAutoArchiveOnMerge(), { wrapper })
  const handler = mockUsePrStatusEvents.mock.calls.at(-1)?.[0] as (
    status: PrStatusEvent
  ) => Promise<void>

  return { handler, queryClient, project }
}

describe('useAutoArchiveOnMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets the backend decide the archive of a regular worktree', async () => {
    mockInvoke.mockResolvedValueOnce('archived')
    const { handler } = setup(makeWorktree())

    await act(async () => {
      await handler(makeMergedPrStatus('worktree-1'))
    })

    expect(mockInvoke).toHaveBeenCalledWith('auto_archive_merged_worktree', {
      worktreeId: 'worktree-1',
      prUrl: 'https://github.com/owner/repo/pull/42',
      headOid: 'abc123',
      delete: false,
    })
    // A direct archive would cancel running sessions without any guard (#50)
    expect(mockInvoke).not.toHaveBeenCalledWith('archive_worktree', {
      worktreeId: 'worktree-1',
    })
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Archived "feature-session" (PR #42 merged)'
    )
  })

  it('tries again on the next poll when the backend defers', async () => {
    mockInvoke.mockResolvedValueOnce('deferred')
    mockInvoke.mockResolvedValueOnce('archived')
    const { handler } = setup(makeWorktree())

    await act(async () => {
      await handler(makeMergedPrStatus('worktree-1'))
    })
    expect(mockToastSuccess).not.toHaveBeenCalled()

    await act(async () => {
      await handler(makeMergedPrStatus('worktree-1'))
    })

    const calls = mockInvoke.mock.calls.filter(
      ([command]) => command === 'auto_archive_merged_worktree'
    )
    expect(calls).toHaveLength(2)
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
  })

  it('does not invoke again for a PR that already auto-archived the worktree', async () => {
    const { handler } = setup(
      makeWorktree({
        auto_archived_pr_url: 'https://github.com/owner/repo/pull/42',
      })
    )

    await act(async () => {
      await handler(makeMergedPrStatus('worktree-1'))
    })

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('refreshes the worktree list without a toast when the link moved to the current branch', async () => {
    mockInvoke.mockResolvedValueOnce('relinked')
    const { handler, queryClient, project } = setup(makeWorktree())

    await act(async () => {
      await handler(makeMergedPrStatus('worktree-1'))
    })

    expect(mockToastSuccess).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(
        queryClient.getQueryCache().find({
          queryKey: projectsQueryKeys.worktrees(project.id),
        })?.state.isInvalidated
      ).toBe(true)
    })
  })

  it('clears merged PR metadata for base sessions without archiving or deleting them', async () => {
    const { handler, queryClient, project } = setup(
      makeWorktree({
        id: 'base-1',
        name: 'main',
        path: '/repo/jean',
        branch: 'main',
        session_type: 'base',
      })
    )

    await act(async () => {
      await handler(makeMergedPrStatus('base-1'))
    })

    expect(mockInvoke).toHaveBeenCalledWith('clear_worktree_pr', {
      worktreeId: 'base-1',
    })
    expect(mockInvoke).not.toHaveBeenCalledWith('archive_worktree', {
      worktreeId: 'base-1',
    })
    expect(mockInvoke).not.toHaveBeenCalledWith('delete_worktree', {
      worktreeId: 'base-1',
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryCache().find({
          queryKey: projectsQueryKeys.worktrees(project.id),
        })?.state.isInvalidated
      ).toBe(true)
    })
  })
})
