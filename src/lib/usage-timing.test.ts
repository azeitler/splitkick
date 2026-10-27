import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getUsageRefetchInterval,
  getUsageStaleTime,
  USAGE_REFRESH_MS,
} from './usage-timing'

const NOW = Date.UTC(2026, 9, 27, 10, 0, 0)

function snapshotFetched(msAgo: number): { fetchedAt: number } {
  return { fetchedAt: (NOW - msAgo) / 1000 }
}

describe('Claude usage timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits until a fresh snapshot is five minutes old', () => {
    const snapshot = snapshotFetched(60_000)
    expect(getUsageRefetchInterval(snapshot)).toBe(USAGE_REFRESH_MS - 60_000)
    expect(getUsageStaleTime(snapshot)).toBe(USAGE_REFRESH_MS - 60_000)
  })

  // The backend answers an expired token, a 429 or another failed refresh with
  // its old cached snapshot. Its fetchedAt stays old, the interval fell to the
  // 1 s minimum, and the usage check ran every second.
  it('waits a full interval after the backend served an old snapshot', () => {
    const snapshot = snapshotFetched(USAGE_REFRESH_MS + 30 * 60_000)
    expect(getUsageRefetchInterval(snapshot)).toBe(USAGE_REFRESH_MS)
    expect(getUsageStaleTime(snapshot)).toBe(USAGE_REFRESH_MS)
  })

  it('never checks again within a few seconds', () => {
    const justExpiring = snapshotFetched(USAGE_REFRESH_MS - 500)
    expect(getUsageRefetchInterval(justExpiring)).toBeGreaterThanOrEqual(30_000)
  })

  it('uses the full interval before the first snapshot', () => {
    expect(getUsageRefetchInterval(undefined)).toBe(USAGE_REFRESH_MS)
  })
})
