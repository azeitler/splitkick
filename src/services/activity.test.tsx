import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useRecentActivity } from './activity'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@/lib/transport', () => ({
  invoke: mocks.invoke,
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useRecentActivity', () => {
  it('returns the records the backend sends', async () => {
    mocks.invoke.mockResolvedValueOnce([{ id: 'a', kind: 'pr_merged', at: 1 }])
    const { result } = renderHook(() => useRecentActivity(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(mocks.invoke).toHaveBeenCalledWith('list_recent_activity', {
      limit: 30,
    })
  })

  it('surfaces a failure as an error, never as an empty feed', async () => {
    // An empty list would read "Nothing yet" and cache as a success, so the
    // query would never retry.
    mocks.invoke.mockRejectedValueOnce(new Error('socket closed'))
    const { result } = renderHook(() => useRecentActivity(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
