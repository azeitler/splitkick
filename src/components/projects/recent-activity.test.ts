import { describe, expect, it } from 'vitest'
import { formatRecentActivity } from './RecentWorktreesList'

describe('formatRecentActivity', () => {
  const now = 1_800_000_000_000

  it.each([
    [now / 1000, 'now'],
    [(now - 5 * 60_000) / 1000, '5m'],
    [(now - 3 * 60 * 60_000) / 1000, '3h'],
    [(now - 4 * 24 * 60 * 60_000) / 1000, '4d'],
    [(now - 60 * 24 * 60 * 60_000) / 1000, '2mo'],
  ])('formats %s as %s', (timestamp, expected) => {
    expect(formatRecentActivity(timestamp, now)).toBe(expected)
  })
})
