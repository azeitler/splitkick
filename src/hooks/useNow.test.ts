import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNow } from './useNow'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('ticks once per interval', () => {
    const { result } = renderHook(() => useNow(60_000))
    const start = result.current
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current - start).toBe(60_000)
  })
})
