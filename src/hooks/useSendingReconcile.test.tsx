import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import { useSendingReconcile } from './useSendingReconcile'

const host = vi.hoisted(() => ({ ids: [] as string[] }))
const warn = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(async (command: string) =>
    command === 'list_sending_sessions' ? host.ids : null
  ),
  useWsConnectionStatus: () => true,
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

const focus = () => act(() => void window.dispatchEvent(new Event('focus')))

describe('useSendingReconcile (#163)', () => {
  beforeEach(() => {
    warn.mockClear()
    host.ids = []
    useChatStore.setState({
      sendingSessionIds: {},
      sendStartedAt: {},
      completedDurations: {},
      waitingForInputSessionIds: {},
    })
  })

  it('clears a stale mark on focus, without a duration, and logs it', async () => {
    useChatStore.setState({
      sendingSessionIds: { s1: true },
      sendStartedAt: { s1: Date.now() - 60_000 },
    })
    renderHook(() => useSendingReconcile(), { wrapper })

    focus()

    await waitFor(() =>
      expect(useChatStore.getState().sendingSessionIds).toEqual({})
    )
    expect(useChatStore.getState().sendStartedAt).toEqual({})
    expect(useChatStore.getState().completedDurations).toEqual({})
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sessionId: 's1', direction: 'clear' })
    )
  })

  it('keeps a pending question when it clears a stale mark', async () => {
    useChatStore.setState({
      sendingSessionIds: { s1: true },
      sendStartedAt: { s1: Date.now() - 60_000 },
      waitingForInputSessionIds: { s1: true },
    })
    renderHook(() => useSendingReconcile(), { wrapper })

    focus()

    await waitFor(() =>
      expect(useChatStore.getState().sendingSessionIds).toEqual({})
    )
    expect(useChatStore.getState().waitingForInputSessionIds).toEqual({
      s1: true,
    })
  })

  it('keeps a send that just started', async () => {
    useChatStore.setState({
      sendingSessionIds: { s1: true },
      sendStartedAt: { s1: Date.now() },
    })
    renderHook(() => useSendingReconcile(), { wrapper })

    focus()
    await new Promise(r => setTimeout(r, 20))

    expect(useChatStore.getState().sendingSessionIds).toEqual({ s1: true })
    expect(warn).not.toHaveBeenCalled()
  })

  it('sets a missing mark for a session the host runs', async () => {
    host.ids = ['s2']
    renderHook(() => useSendingReconcile(), { wrapper })

    focus()

    await waitFor(() =>
      expect(useChatStore.getState().sendingSessionIds).toEqual({ s2: true })
    )
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sessionId: 's2', direction: 'add' })
    )
  })
})
