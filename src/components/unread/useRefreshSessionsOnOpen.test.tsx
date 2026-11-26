import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AllSessionsResponse, Session } from '@/types/chat'
import { useRefreshSessionsOnOpen } from './useRefreshSessionsOnOpen'

function setup() {
  const queryClient = new QueryClient()
  const data: AllSessionsResponse = {
    entries: [
      {
        project_id: 'p1',
        project_name: 'Acme',
        worktree_id: 'wt-1',
        worktree_name: 'main',
        worktree_path: '/tmp/wt-1',
        sessions: [
          { id: 's-1', last_opened_at: 10 } as Session,
          { id: 's-2', last_opened_at: 20 } as Session,
        ],
      },
    ],
  }
  queryClient.setQueryData(['all-sessions'], data)
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  renderHook(() => useRefreshSessionsOnOpen(), { wrapper })
  const open = (detail?: { sessionIds: string[] }) =>
    act(() => {
      window.dispatchEvent(new CustomEvent('session-opened', { detail }))
    })
  const session = (id: string) =>
    queryClient
      .getQueryData<AllSessionsResponse>(['all-sessions'])
      ?.entries[0]?.sessions.find(s => s.id === id)
  return { invalidate, open, session }
}

describe('useRefreshSessionsOnOpen', () => {
  it('patches the opened session in place without a refetch', () => {
    const { invalidate, open, session } = setup()
    open({ sessionIds: ['s-1'] })

    expect(invalidate).not.toHaveBeenCalled()
    expect(session('s-1')?.last_opened_at).toBeGreaterThan(1_000_000_000)
    expect(session('s-2')?.last_opened_at).toBe(20)
  })

  it('refetches when the event names no session or an unknown one', () => {
    const { invalidate, open } = setup()
    open()
    open({ sessionIds: ['unknown'] })

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['all-sessions'] })
  })
})
