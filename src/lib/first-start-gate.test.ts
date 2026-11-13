import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/store/ui-store'
import {
  FIRST_START_SETTLE_MS,
  isFirstStartFlowActive,
  useFirstStartIdle,
} from './first-start-gate'

describe('first-start gate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUIStore.setState({ onboardingOpen: false, featureTourOpen: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is active while the setup dialog or the tour is open', () => {
    expect(
      isFirstStartFlowActive({ onboardingOpen: true, featureTourOpen: false })
    ).toBe(true)
    expect(
      isFirstStartFlowActive({ onboardingOpen: false, featureTourOpen: true })
    ).toBe(true)
    expect(
      isFirstStartFlowActive({ onboardingOpen: false, featureTourOpen: false })
    ).toBe(false)
  })

  it('queues surfaces through setup, the hand-off gap and the tour', () => {
    useUIStore.setState({ onboardingOpen: true })
    const { result } = renderHook(() => useFirstStartIdle())
    expect(result.current).toBe(false)

    // Setup closes; the tour opens 300 ms later (OnboardingDialog / App)
    act(() => useUIStore.setState({ onboardingOpen: false }))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(300))
    act(() => useUIStore.setState({ featureTourOpen: true }))
    act(() => vi.advanceTimersByTime(FIRST_START_SETTLE_MS * 2))
    expect(result.current).toBe(false)

    // Tour ends: idle only after the settle time
    act(() => useUIStore.setState({ featureTourOpen: false }))
    act(() => vi.advanceTimersByTime(FIRST_START_SETTLE_MS - 1))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('is idle at once when no first-start flow runs', () => {
    const { result } = renderHook(() => useFirstStartIdle())
    expect(result.current).toBe(true)
  })
})
