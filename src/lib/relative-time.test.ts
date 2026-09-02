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
const WEEK = 7 * DAY

describe('toMilliseconds', () => {
  it('scales unix seconds up to milliseconds', () => {
    expect(toMilliseconds(1_700_000_000)).toBe(1_700_000_000_000)
  })

  it('leaves millisecond timestamps untouched', () => {
    expect(toMilliseconds(1_700_000_000_000)).toBe(1_700_000_000_000)
  })
})

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 8, 1)

  it('formats minutes, hours and days', () => {
    expect(formatRelativeTime(now - 5 * MINUTE, now)).toBe('5m ago')
    expect(formatRelativeTime(now - 3 * HOUR, now)).toBe('3h ago')
    expect(formatRelativeTime(now - 2 * DAY, now)).toBe('2d ago')
  })

  it('defaults to the current clock', () => {
    expect(formatRelativeTime(Date.now() - 3 * HOUR)).toBe('3h ago')
  })

  it('formats weeks, months and years', () => {
    expect(formatRelativeTime(now - 6 * WEEK, now)).toBe('6w ago')
    expect(formatRelativeTime(now - 100 * DAY, now)).toBe('3mo ago')
    expect(formatRelativeTime(now - 800 * DAY, now)).toBe('2y ago')
  })

  it('uses mo for months so it never collides with m for minutes', () => {
    expect(formatRelativeTime(now - 3 * MINUTE, now)).toBe('3m ago')
    expect(formatRelativeTime(now - 90 * DAY, now)).toBe('3mo ago')
  })

  it('steps up through the units without reading backwards', () => {
    // Days hand over to weeks at 7d, weeks to months at 60d, months to years
    // at 365d. Months start at 2mo so "8w" is never followed by "1mo".
    expect(formatRelativeTime(now - (7 * DAY - 1), now)).toBe('6d ago')
    expect(formatRelativeTime(now - 7 * DAY, now)).toBe('1w ago')
    expect(formatRelativeTime(now - (60 * DAY - 1), now)).toBe('8w ago')
    expect(formatRelativeTime(now - 60 * DAY, now)).toBe('2mo ago')
    expect(formatRelativeTime(now - (365 * DAY - 1), now)).toBe('12mo ago')
    expect(formatRelativeTime(now - 365 * DAY, now)).toBe('1y ago')
  })

  it('normalizes second-precision timestamps', () => {
    expect(formatRelativeTime(Math.floor((now - 6 * WEEK) / 1000), now)).toBe(
      '6w ago'
    )
  })

  it('treats future timestamps as just now', () => {
    expect(formatRelativeTime(now + DAY, now)).toBe('just now')
  })
})

describe('formatMessageTimestamp', () => {
  // Local-time constructors keep the assertions timezone independent.
  const now = new Date(2026, 8, 1, 14, 32).getTime()
  const shortMonth = (date: Date) =>
    date.toLocaleDateString(undefined, { month: 'short' })

  it('shows a 24-hour clock time only for messages from today', () => {
    expect(formatMessageTimestamp(new Date(2026, 8, 1, 13, 23).getTime(), now)) //
      .toBe('13:23')
    expect(formatMessageTimestamp(new Date(2026, 8, 1, 9, 5).getTime(), now)) //
      .toBe('09:05')
  })

  it('adds the date for messages from an earlier day', () => {
    const at = new Date(2026, 8, 1, 13, 23)
    // The "today" cutoff is the calendar day, not a rolling 24 hours.
    const later = new Date(2026, 8, 2, 1, 0).getTime()
    expect(formatMessageTimestamp(at.getTime(), later)).toBe(
      `${shortMonth(at)} 1st 26, 13:23`
    )
  })

  it('picks the right English ordinal for the day of month', () => {
    const cases: [number, string][] = [
      [1, '1st'],
      [2, '2nd'],
      [3, '3rd'],
      [4, '4th'],
      [11, '11th'],
      [12, '12th'],
      [13, '13th'],
      [21, '21st'],
      [22, '22nd'],
      [23, '23rd'],
      [31, '31st'],
    ]
    for (const [day, expected] of cases) {
      const at = new Date(2026, 0, day, 13, 23)
      expect(formatMessageTimestamp(at.getTime(), now)).toBe(
        `${shortMonth(at)} ${expected} 26, 13:23`
      )
    }
  })

  it('shortens the year to two digits', () => {
    const at = new Date(2007, 8, 1, 13, 23)
    expect(formatMessageTimestamp(at.getTime(), now)).toBe(
      `${shortMonth(at)} 1st 07, 13:23`
    )
  })

  it('accepts unix seconds', () => {
    const at = new Date(2026, 8, 1, 9, 5).getTime()
    expect(formatMessageTimestamp(Math.floor(at / 1000), now)).toBe('09:05')
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
