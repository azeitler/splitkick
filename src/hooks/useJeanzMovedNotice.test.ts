import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ info: vi.fn(), product: 'JeanZ' }))

vi.mock('sonner', () => ({ toast: { info: mocks.info } }))
vi.mock('@/lib/build-info', () => ({
  get PRODUCT_NAME() {
    return mocks.product
  },
}))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => true }))
vi.mock('@/lib/platform', () => ({ openExternal: vi.fn() }))

import { useJeanzMovedNotice } from './useJeanzMovedNotice'

describe('useJeanzMovedNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.product = 'JeanZ'
  })

  it('tells a JeanZ user once', () => {
    // The test setup stubs localStorage; model "not seen", then "seen".
    vi.mocked(localStorage.getItem)
      .mockReturnValueOnce(null)
      .mockReturnValue('2026-10-14')
    renderHook(() => useJeanzMovedNotice())
    renderHook(() => useJeanzMovedNotice())
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'jeanz-moved-to-splitkick-notice',
      expect.any(String)
    )
    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info).toHaveBeenCalledWith(
      'JeanZ is now Splitkick',
      expect.objectContaining({ duration: Infinity })
    )
  })

  it('stays quiet in other builds', () => {
    mocks.product = 'Jean'
    renderHook(() => useJeanzMovedNotice())
    expect(mocks.info).not.toHaveBeenCalled()
  })
})
