import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isLocalBackend: vi.fn(),
  isNativeApp: vi.fn(),
  openExternal: vi.fn(),
  preOpenWindow: vi.fn(),
  getRemotePreviewUrl: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({ invoke: mocks.invoke }))
vi.mock('@/lib/environment', () => ({
  isLocalBackend: mocks.isLocalBackend,
  isNativeApp: mocks.isNativeApp,
}))
vi.mock('@/lib/platform', () => ({
  openExternal: mocks.openExternal,
  preOpenWindow: mocks.preOpenWindow,
}))
vi.mock('@/lib/remote-preview', () => ({
  getRemotePreviewUrl: mocks.getRemotePreviewUrl,
}))

import { openFileInBrowser } from './open-in-browser'

describe('openFileInBrowser', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(m => m.mockReset())
  })

  it('opens a local file with the system default app', async () => {
    mocks.isLocalBackend.mockReturnValue(true)
    await openFileInBrowser('/repo/report.html')
    expect(mocks.invoke).toHaveBeenCalledWith('open_path_in_default_app', {
      path: '/repo/report.html',
    })
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('opens the backend preview URL from a remote connection window', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    mocks.isNativeApp.mockReturnValue(true)
    mocks.preOpenWindow.mockReturnValue(null)
    mocks.getRemotePreviewUrl.mockResolvedValue(
      'https://remote/preview/a/b/r.html'
    )
    await openFileInBrowser('/repo/report.html')
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://remote/preview/a/b/r.html',
      null
    )
  })

  it('opens the preview URL in a pre-opened tab in Web Access', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    mocks.isNativeApp.mockReturnValue(false)
    const tab = { opener: window, close: vi.fn() }
    mocks.preOpenWindow.mockReturnValue(tab)
    mocks.invoke.mockResolvedValue({ url: '/preview/root/sig/report.html' })
    await openFileInBrowser('/repo/report.html')
    expect(mocks.invoke).toHaveBeenCalledWith('get_preview_url', {
      path: '/repo/report.html',
    })
    expect(mocks.openExternal).toHaveBeenCalledWith(
      `${window.location.origin}/preview/root/sig/report.html`,
      tab
    )
    // The opened page gets no handle on the app window.
    expect(tab.opener).toBeNull()
  })

  it('closes the pre-opened tab when the URL cannot be made', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    mocks.isNativeApp.mockReturnValue(false)
    const tab = { opener: null, close: vi.fn() }
    mocks.preOpenWindow.mockReturnValue(tab)
    mocks.invoke.mockRejectedValue(new Error('HTTP server is not running'))
    await expect(openFileInBrowser('/repo/report.html')).rejects.toThrow(
      'HTTP server is not running'
    )
    expect(tab.close).toHaveBeenCalled()
  })
})
