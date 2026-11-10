import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ native: false, remote: null as object | null }))
const toastWarning = vi.hoisted(() => vi.fn())
vi.mock('@/lib/environment', () => ({ isNativeApp: () => env.native }))
vi.mock('@/lib/remote-connections', () => ({
  getActiveRemoteConnection: () => env.remote,
}))
vi.mock('@/lib/service-worker', () => ({
  updateServiceWorkerAndReload: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { warning: toastWarning } }))

import { CLIENT_WEB_BUILD_ID } from '@/lib/build-info'

describe('web client version check (#72)', () => {
  beforeEach(() => {
    vi.resetModules()
    toastWarning.mockReset()
    env.native = false
    env.remote = null
  })

  it('shows the toast for a newer server build', async () => {
    const { checkWebClientVersion } = await import('./web-client-version')
    expect(checkWebClientVersion({ webBuildId: 'newer' })).toBe(true)
    expect(toastWarning).toHaveBeenCalledOnce()
  })

  it('is quiet for the same build', async () => {
    const { checkWebClientVersion } = await import('./web-client-version')
    expect(checkWebClientVersion({ webBuildId: CLIENT_WEB_BUILD_ID })).toBe(
      false
    )
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('is quiet on a remote connection, where a reload cannot help', async () => {
    env.remote = { id: 'mb16' }
    const { checkWebClientVersion } = await import('./web-client-version')
    expect(checkWebClientVersion({ webBuildId: 'newer' })).toBe(false)
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it("checks this page's own server when the preload failed", async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ webBuildId: 'newer' }), { status: 200 })
      )
    const { checkWebClientVersionFromOrigin } =
      await import('./web-client-version')
    expect(await checkWebClientVersionFromOrigin()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/jean-build.json', {
      cache: 'no-store',
    })
    fetchMock.mockRestore()
  })

  it('stays quiet when the server cannot be reached', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('offline'))
    const { checkWebClientVersionFromOrigin } =
      await import('./web-client-version')
    expect(await checkWebClientVersionFromOrigin()).toBe(false)
    fetchMock.mockRestore()
  })
})
