import { describe, it, expect } from 'vitest'
import {
  formatLastActive,
  formatMessageTimestamp,
  formatRelativeTime,
  toMilliseconds,
} from './relative-time'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('toMilliseconds', () => {
  it('scales unix seconds up to milliseconds', () => {
    expect(toMilliseconds(1_700_000_000)).toBe(1_700_000_000_000)
  })

  it('leaves millisecond timestamps untouched', () => {
    expect(toMilliseconds(1_700_000_000_000)).toBe(1_700_000_000_000)
  })
})

describe('formatRelativeTime', () => {
  it('formats minutes, hours and days', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 5 * MINUTE)).toBe('5m ago')
    expect(formatRelativeTime(now - 3 * HOUR)).toBe('3h ago')
    expect(formatRelativeTime(now - 2 * DAY)).toBe('2d ago')
  })
})

describe('formatMessageTimestamp', () => {
  // Local-time constructors keep the assertions timezone independent.
  const now = new Date(2026, 8, 1, 14, 32).getTime()

  it('shows the time only for messages from today', () => {
    const at = new Date(2026, 8, 1, 9, 5).getTime()
    expect(formatMessageTimestamp(at, now)).toBe(
      new Date(at).toLocaleTimeString(undefined, { timeStyle: 'short' })
    )
  })

  it('adds the date for messages from an earlier day', () => {
    const at = new Date(2026, 7, 30, 9, 5).getTime()
    expect(formatMessageTimestamp(at, now)).toBe(
      new Date(at).toLocaleString(undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    )
  })

  it('treats the same clock time on a different day as an earlier day', () => {
    const sameTimeYesterday = new Date(2026, 7, 31, 14, 32).getTime()
    expect(formatMessageTimestamp(sameTimeYesterday, now)).not.toBe(
      formatMessageTimestamp(now, now)
    )
  })

  it('accepts unix seconds', () => {
    const at = new Date(2026, 8, 1, 9, 5).getTime()
    expect(formatMessageTimestamp(Math.floor(at / 1000), now)).toBe(
      formatMessageTimestamp(at, now)
    )
  })
})

describe('formatLastActive', () => {
  const now = 1_800_000_000_000

  it('reports sub-minute and future ages as just now', () => {
    expect(formatLastActive(now - 30_000, now)).toBe('just now')
    expect(formatLastActive(now + 5 * MINUTE, now)).toBe('just now')
  })

  it('formats minutes with correct pluralization', () => {
    expect(formatLastActive(now - MINUTE, now)).toBe('1 minute ago')
    expect(formatLastActive(now - 5 * MINUTE, now)).toBe('5 minutes ago')
  })

  it('formats hours up to the 36h threshold', () => {
    expect(formatLastActive(now - HOUR, now)).toBe('1 hour ago')
    expect(formatLastActive(now - 90 * MINUTE, now)).toBe('2 hours ago')
    expect(formatLastActive(now - 35 * HOUR, now)).toBe('35 hours ago')
  })

  it('switches to days at 36h so it reads "2 days ago"', () => {
    expect(formatLastActive(now - (36 * HOUR - 1), now)).toBe('36 hours ago')
    expect(formatLastActive(now - 36 * HOUR, now)).toBe('2 days ago')
  })

  it('formats older ages in days', () => {
    expect(formatLastActive(now - 3 * DAY, now)).toBe('3 days ago')
    expect(formatLastActive(now - 14 * DAY, now)).toBe('14 days ago')
  })

  it('accepts unix seconds', () => {
    expect(formatLastActive(Math.floor((now - 3 * DAY) / 1000), now)).toBe(
      '3 days ago'
    )
  })
})
