import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn(() => Promise.resolve())
const listeners = new Map<string, () => void>()
const nativeMock = vi.fn(() => true)

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [])),
  listenLocal: (event: string, handler: () => void) => {
    listeners.set(event, handler)
    return Promise.resolve(() => listeners.delete(event))
  },
}))

vi.mock('@/lib/environment', () => ({ isNativeApp: () => nativeMock() }))

const { LIVENESS_PING_EVENT, installWebviewLivenessResponder, livenessAnswer } =
  await import('./webview-liveness')

describe('webview liveness responder (#97)', () => {
  beforeEach(() => {
    invokeMock.mockClear()
    listeners.clear()
    nativeMock.mockReturnValue(true)
    document.body.innerHTML = ''
  })

  it('answers a ping with the rendered state and page numbers', () => {
    document.body.innerHTML = '<div id="root"><main><p>hi</p></main></div>'
    installWebviewLivenessResponder()
    listeners.get(LIVENESS_PING_EVENT)?.()
    expect(invokeMock).toHaveBeenCalledWith('webview_liveness_pong', {
      rendered: true,
      stats: {
        queries: 0,
        domNodes: expect.any(Number),
        messages: 0,
        messageChars: 0,
      },
    })
  })

  it('reports an empty root as not rendered', () => {
    document.body.innerHTML = '<div id="root"></div>'
    expect(livenessAnswer().rendered).toBe(false)
    document.body.innerHTML = ''
    expect(livenessAnswer().rendered).toBe(false)
  })

  it('does nothing outside the desktop app', () => {
    nativeMock.mockReturnValue(false)
    installWebviewLivenessResponder()
    expect(listeners.size).toBe(0)
  })
})

describe('takeWebviewRecovery (#97)', () => {
  it('asks the shell once per page load', async () => {
    vi.resetModules()
    nativeMock.mockReturnValue(true)
    const note = {
      reason: 'web content process terminated',
      at: 1,
      details: 'x',
    }
    invokeMock.mockClear()
    invokeMock.mockImplementation((() => Promise.resolve(note)) as never)
    const { takeWebviewRecovery } = await import('./webview-liveness')
    await expect(takeWebviewRecovery()).resolves.toEqual(note)
    await expect(takeWebviewRecovery()).resolves.toEqual(note)
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('take_webview_recovery')
  })
})
