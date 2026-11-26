import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { describeLoadingState, loadingPhase, retryQuery } from './loading-state'

describe('loadingPhase', () => {
  it('starts as loading, turns slow, and an error wins', () => {
    expect(loadingPhase({ isError: false, isSlow: false })).toBe('loading')
    expect(loadingPhase({ isError: false, isSlow: true })).toBe('slow')
    expect(loadingPhase({ isError: true, isSlow: false })).toBe('error')
    expect(loadingPhase({ isError: true, isSlow: true })).toBe('error')
  })
})

describe('describeLoadingState', () => {
  const base = { subject: 'session', connected: true }

  it('says what loads and offers no retry at first', () => {
    expect(describeLoadingState({ ...base, phase: 'loading' })).toEqual({
      title: 'Loading session…',
      detail: null,
      showRetry: false,
    })
  })

  it('explains a slow load with the connection up', () => {
    expect(describeLoadingState({ ...base, phase: 'slow' })).toEqual({
      title: 'Loading session…',
      detail: 'This is taking longer than usual…',
      showRetry: true,
    })
  })

  it('names a lost connection', () => {
    expect(
      describeLoadingState({ ...base, connected: false, phase: 'slow' }).detail
    ).toBe('Connection lost. Reconnecting…')
    expect(
      describeLoadingState({ ...base, connected: false, phase: 'error' }).detail
    ).toBe('Connection lost. Reconnecting…')
  })

  it('shows the error with Retry', () => {
    expect(
      describeLoadingState({
        ...base,
        phase: 'error',
        errorMessage: "Command 'get_session' timed out after 60s",
      })
    ).toEqual({
      title: 'Could not load the session.',
      detail: "Command 'get_session' timed out after 60s",
      showRetry: true,
    })
  })
})

describe('retryQuery', () => {
  it('unsticks a first load that never answers', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 0 } },
    })
    let calls = 0
    const observer = new QueryObserver(client, {
      queryKey: ['session', 'a'],
      queryFn: () => {
        calls += 1
        // The first request hangs, as on a dead connection.
        return calls === 1 ? new Promise<string>(() => undefined) : 'loaded'
      },
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await Promise.resolve()
    expect(calls).toBe(1)

    // A plain refetch joins the hung request and never ends.
    void observer.refetch()
    await Promise.resolve()
    expect(calls).toBe(1)

    await retryQuery(client, ['session', 'a'])
    expect(calls).toBe(2)
    expect(client.getQueryData(['session', 'a'])).toBe('loaded')
    unsubscribe()
  })
})
