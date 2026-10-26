import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LimitHitBanner } from './LimitHitBanner'
import { formatLimitHit } from './limit-hit'

describe('formatLimitHit', () => {
  const now = new Date(2026, 9, 26, 18, 30).getTime()

  it('shows the time until the reset with the clock time', () => {
    const resetsAt = Math.floor(new Date(2026, 9, 26, 20, 30).getTime() / 1000)
    expect(formatLimitHit({ resets_at: resetsAt }, now)).toBe(
      'Session limit hit · resets in 2h (20:30)'
    )
  })

  it('shows how long ago the limit reset', () => {
    const resetsAt = Math.floor(new Date(2026, 9, 26, 17, 30).getTime() / 1000)
    expect(formatLimitHit({ resets_at: resetsAt }, now)).toBe(
      'Session limit hit · reset 1h ago (17:30)'
    )
  })

  it('works without a reset time', () => {
    expect(formatLimitHit({}, now)).toBe('Session limit hit')
  })
})

describe('LimitHitBanner', () => {
  it('resumes with "continue" or hands over to the composer', () => {
    const onResume = vi.fn()
    const onResumeWithMessage = vi.fn()
    render(
      <LimitHitBanner
        limit={{}}
        onResume={onResume}
        onResumeWithMessage={onResumeWithMessage}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(onResume).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Resume with message' }))
    expect(onResumeWithMessage).toHaveBeenCalledTimes(1)
  })
})
