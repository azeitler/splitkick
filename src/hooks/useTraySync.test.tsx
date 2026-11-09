import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
  native: true,
  linux: false,
  preferences: undefined as unknown,
}))

vi.mock('@/lib/transport', () => ({ invoke: mocks.invoke }))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => mocks.native }))
vi.mock('@/lib/platform', () => ({
  get isClientLinux() {
    return mocks.linux
  },
}))
vi.mock('@/lib/remote-connections', () => ({
  isConnectionWindow: () => false,
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: mocks.preferences }),
}))

import { useTraySync } from './useTraySync'

const prefs = (active: string | null) => ({
  show_in_menu_bar: true,
  claude_active_account: active,
  claude_accounts: [],
})

describe('useTraySync', () => {
  beforeEach(() => {
    mocks.invoke.mockClear()
    mocks.native = true
    mocks.linux = false
    mocks.preferences = prefs(null)
  })

  it('rebuilds once, and again when the active account changes', () => {
    const { rerender } = renderHook(() => useTraySync())
    rerender()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    mocks.preferences = prefs('work')
    rerender()
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
  })

  it('does nothing in web access or on Linux', () => {
    mocks.native = false
    renderHook(() => useTraySync())
    mocks.native = true
    mocks.linux = true
    renderHook(() => useTraySync())
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
