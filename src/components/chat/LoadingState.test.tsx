import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadingState } from './LoadingState'
import { SLOW_LOADING_MS } from './loading-state'

const transport = vi.hoisted(() => ({ connected: true, ws: true }))
vi.mock('@/lib/transport', () => ({
  useWsConnectionStatus: () => transport.connected,
  usesWebSocketBackend: () => transport.ws,
}))

describe('LoadingState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    transport.connected = true
    transport.ws = true
  })
  afterEach(() => vi.useRealTimers())

  it('shows the slow hint and Retry after the delay', () => {
    const onRetry = vi.fn()
    render(<LoadingState subject="session" onRetry={onRetry} />)

    expect(screen.getByText('Loading session…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()

    act(() => vi.advanceTimersByTime(SLOW_LOADING_MS))

    expect(
      screen.getByText('This is taking longer than usual…')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says the connection is lost when the socket is down', () => {
    transport.connected = false
    render(<LoadingState subject="session" onRetry={vi.fn()} />)
    act(() => vi.advanceTimersByTime(SLOW_LOADING_MS))
    expect(
      screen.getByText('Connection lost. Reconnecting…')
    ).toBeInTheDocument()
  })

  it('does not blame the connection in the native app on its own backend', () => {
    transport.connected = false
    transport.ws = false
    render(<LoadingState subject="session" onRetry={vi.fn()} />)
    act(() => vi.advanceTimersByTime(SLOW_LOADING_MS))
    expect(
      screen.getByText('This is taking longer than usual…')
    ).toBeInTheDocument()
  })

  it('shows a skeleton of the session while it loads', () => {
    const { container } = render(
      <LoadingState subject="session" layout="page" onBack={vi.fn()} />
    )
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(container.querySelector('.animate-spin')).toBeNull()
    // The page has its own Back from the start.
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('replaces the skeleton with the error', () => {
    const { container } = render(
      <LoadingState
        subject="session"
        layout="page"
        error={new Error('timed out')}
        onRetry={vi.fn()}
      />
    )
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows an error at once, with Retry and Back', () => {
    const onBack = vi.fn()
    render(
      <LoadingState
        subject="session"
        error={new Error('timed out')}
        onRetry={vi.fn()}
        onBack={onBack}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the session.'
    )
    expect(screen.getByText('timed out')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
