import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isNativeApp, isConnectionWindow, onCloseRequested } = vi.hoisted(
  () => ({
    isNativeApp: vi.fn(() => true),
    isConnectionWindow: vi.fn(() => false),
    onCloseRequested: vi.fn(async () => () => {
      // no-op unlisten
    }),
  })
)

vi.mock('@/lib/environment', () => ({ isNativeApp: () => isNativeApp() }))
vi.mock('@/lib/remote-connections', () => ({
  isConnectionWindow: () => isConnectionWindow(),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested }),
}))

import { useNativeWindowCloseGuard } from './useNativeWindowCloseGuard'

describe('useNativeWindowCloseGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativeApp.mockReturnValue(true)
    isConnectionWindow.mockReturnValue(false)
    vi.stubEnv('DEV', false)
  })

  it('guards the local window, where quitting ends running sessions', async () => {
    renderHook(() => useNativeWindowCloseGuard())

    await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())
  })

  it('leaves a connection window alone', async () => {
    // Its sessions run on the remote and outlive the window, so there is
    // nothing to confirm — and the quit path would close the whole app.
    isConnectionWindow.mockReturnValue(true)

    renderHook(() => useNativeWindowCloseGuard())

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onCloseRequested).not.toHaveBeenCalled()
  })
})
