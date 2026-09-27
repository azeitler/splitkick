import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockInvoke = vi.fn()
const mockDestroy = vi.fn().mockResolvedValue(undefined)
const mockHasBackend = vi.fn(() => true)
const mockIsNativeApp = vi.fn(() => true)

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('@/lib/environment', () => ({
  hasBackend: () => mockHasBackend(),
  isNativeApp: () => mockIsNativeApp(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: mockDestroy,
  }),
}))

describe('window-close helpers', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockDestroy.mockReset()
    mockDestroy.mockResolvedValue(undefined)
    mockHasBackend.mockReturnValue(true)
    mockIsNativeApp.mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips the running-session check while the backend is unavailable', async () => {
    mockHasBackend.mockReturnValue(false)
    mockIsNativeApp.mockReturnValue(false)
    // Fresh import not required — module reads mocks at call time
    const { checkHasRunningSessions } = await import('./window-close')

    await expect(checkHasRunningSessions()).resolves.toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('checks local sessions when a native remote backend is disconnected', async () => {
    mockHasBackend.mockReturnValue(false)
    mockIsNativeApp.mockReturnValue(true)
    mockInvoke.mockResolvedValue(true)
    const { checkHasRunningSessions } = await import('./window-close')

    await expect(checkHasRunningSessions()).resolves.toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('has_running_sessions')
  })

  it('fail-opens when has_running_sessions times out', async () => {
    mockInvoke.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves — hung WS during loading */
        })
    )
    const { checkHasRunningSessions } = await import('./window-close')

    await expect(checkHasRunningSessions(30)).resolves.toBe(false)
  })

  it('returns true when sessions are running', async () => {
    mockInvoke.mockResolvedValue(true)
    const { checkHasRunningSessions } = await import('./window-close')

    await expect(checkHasRunningSessions()).resolves.toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('has_running_sessions')
  })

  it('destroys the window when quit is allowed', async () => {
    mockInvoke.mockResolvedValue(false)
    const { requestAppQuit } = await import('./window-close')

    await requestAppQuit()
    // In vitest import.meta.env.DEV is typically true, so session check is
    // skipped and destroy runs immediately — same as production-allowed path.
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('no-ops when not running as a native app', async () => {
    mockIsNativeApp.mockReturnValue(false)
    const { requestAppQuit } = await import('./window-close')

    await requestAppQuit()
    expect(mockDestroy).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  // The quit path destroys the webview, so no page unload fires. A session
  // switch made in the last 500 ms only survives if the write finishes first.
  it('writes the pending UI state before it destroys the window', async () => {
    const { registerUIStateSaver } = await import('./ui-state-teardown')
    const order: string[] = []
    let finishSave: (() => void) | undefined
    registerUIStateSaver(
      () =>
        new Promise<void>(resolve => {
          order.push('save-started')
          finishSave = () => {
            order.push('save-finished')
            resolve()
          }
        })
    )
    mockDestroy.mockImplementation(() => {
      order.push('destroyed')
      return Promise.resolve()
    })

    const { destroyAppWindow } = await import('./window-close')
    const pending = destroyAppWindow()
    await Promise.resolve()

    expect(mockDestroy).not.toHaveBeenCalled()
    finishSave?.()
    await pending

    expect(order).toEqual(['save-started', 'save-finished', 'destroyed'])
    registerUIStateSaver(null)
  })

  it('still quits when the UI state write fails', async () => {
    const { registerUIStateSaver } = await import('./ui-state-teardown')
    registerUIStateSaver(() => Promise.reject(new Error('save failed')))

    const { destroyAppWindow } = await import('./window-close')
    await destroyAppWindow()

    expect(mockDestroy).toHaveBeenCalledOnce()
    registerUIStateSaver(null)
  })
})
