import { describe, expect, it } from 'vitest'
import { describeRecurrence } from './schedule-format'

const tz = 'Europe/Berlin'
const rule = (cron: string) => ({ cron, tz })

describe('describeRecurrence', () => {
  it('names the common repeat rules', () => {
    expect(describeRecurrence(rule('15 * * * *'), tz)).toBe('every hour at :15')
    expect(describeRecurrence(rule('0 9 * * *'), tz)).toBe('daily at 09:00')
    expect(describeRecurrence(rule('30 8 * * 1-5'), tz)).toBe(
      'weekdays at 08:30'
    )
    expect(describeRecurrence(rule('0 9 * * 1'), tz)).toBe(
      'every Monday at 09:00'
    )
    expect(describeRecurrence(rule('0 9 * * 7'), tz)).toBe(
      'every Sunday at 09:00'
    )
  })

  it('shows other patterns as cron', () => {
    expect(describeRecurrence(rule('*/10 9-17 * * *'), tz)).toBe(
      'cron "*/10 9-17 * * *"'
    )
    expect(describeRecurrence(rule('0 9 1 * *'), tz)).toBe('cron "0 9 1 * *"')
  })

  it('adds a time zone that is not the local one', () => {
    expect(describeRecurrence(rule('0 9 * * *'), 'UTC')).toBe(
      'daily at 09:00 (Europe/Berlin)'
    )
  })
})
