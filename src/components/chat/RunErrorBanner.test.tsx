import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { RunError } from '@/types/chat'
import { RunErrorBanner } from './RunErrorBanner'
import { formatRunError, getRunErrorTitle } from './run-error'

function renderBanner(error: RunError) {
  const handlers = {
    onResume: vi.fn(),
    onResumeWithMessage: vi.fn(),
    onRetry: vi.fn(),
    onLogin: vi.fn(),
  }
  render(<RunErrorBanner error={error} {...handlers} />)
  return handlers
}

describe('run error titles', () => {
  it('names each kind of failure', () => {
    expect(
      getRunErrorTitle({ kind: 'api_error', message: 'API Error: 500' })
    ).toBe('Request failed')
    expect(getRunErrorTitle({ kind: 'aborted', message: 'x' })).toBe(
      'Message not sent'
    )
    expect(getRunErrorTitle({ kind: 'crashed', message: '' })).toBe(
      'Run stopped unexpectedly'
    )
    expect(
      getRunErrorTitle({
        kind: 'api_error',
        message: 'Failed to authenticate: OAuth session expired',
      })
    ).toBe('Not logged in')
    // Claude's 401 text does not say "log in"; the kind does (#112).
    expect(
      getRunErrorTitle({
        kind: 'auth_failed',
        message: 'Invalid API key · Fix external API key',
      })
    ).toBe('Not logged in')
  })

  it('shortens long messages for the tooltip', () => {
    const label = formatRunError({
      kind: 'api_error',
      message: 'x'.repeat(300),
    })
    expect(label).toBe(`Request failed: ${'x'.repeat(200)}…`)
    expect(formatRunError({ kind: 'crashed', message: '' })).toBe(
      'Run stopped unexpectedly'
    )
  })
})

describe('RunErrorBanner', () => {
  it('resumes an API error with "continue" or the composer', () => {
    const h = renderBanner({
      kind: 'api_error',
      message: 'API Error: 529 Overloaded',
    })
    expect(screen.getByText('API Error: 529 Overloaded')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(h.onResume).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Resume with message' }))
    expect(h.onResumeWithMessage).toHaveBeenCalledTimes(1)
  })

  it('offers Log in for an expired login', () => {
    const h = renderBanner({
      kind: 'api_error',
      message: 'Failed to authenticate: OAuth session expired',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(h.onLogin).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('offers Log in for a Claude authentication failure', () => {
    const h = renderBanner({
      kind: 'auth_failed',
      message: 'Invalid API key · Fix external API key',
    })
    expect(
      screen.getByText('Invalid API key · Fix external API key')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(h.onLogin).toHaveBeenCalledTimes(1)
  })

  it('retries an aborted send with the original message', () => {
    const h = renderBanner({
      kind: 'aborted',
      message: 'Codex server connection lost.',
      retry_message: 'Fix the sidebar',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(h.onRetry).toHaveBeenCalledWith('Fix the sidebar')
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    expect(h.onResumeWithMessage).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })
})
