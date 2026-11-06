import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { toast } from 'sonner'

const invokeMock = vi.fn()
const menuListeners = new Map<string, (payload: unknown) => void>()
const nativeMock = vi.fn(() => true)
const copyMock = vi.fn(() => Promise.resolve())

vi.mock('@/lib/webview-liveness', () => ({
  takeWebviewRecovery: () => invokeMock('take_webview_recovery'),
}))
vi.mock('@/lib/transport', () => ({
  listenMenu: (event: string, handler: (payload: unknown) => void) => {
    menuListeners.set(event, handler)
    return Promise.resolve(() => menuListeners.delete(event))
  },
}))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => nativeMock() }))
vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...(args as [])),
}))
vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

const { useWebviewRecovery } = await import('./useWebviewRecovery')

describe('useWebviewRecovery (#97)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    menuListeners.clear()
    nativeMock.mockReturnValue(true)
  })

  it('shows the recovery toast once and copies the details', async () => {
    invokeMock.mockResolvedValue({
      reason: 'web content process terminated',
      at: 1,
      details: 'DETAILS',
    })
    renderHook(() => useWebviewRecovery())
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1))
    expect(invokeMock).toHaveBeenCalledWith('take_webview_recovery')
    const [title, options] = vi.mocked(toast.warning).mock.calls[0] as [
      string,
      { description: string; action: { label: string; onClick: () => void } },
    ]
    expect(title).toMatch(/recovered from a display crash$/)
    expect(options.description).toBe('web content process terminated')
    expect(options.action.label).toBe('Copy details')
    options.action.onClick()
    expect(copyMock).toHaveBeenCalledWith('DETAILS')
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Details copied')
    )
  })

  it('stays quiet after a normal start', async () => {
    invokeMock.mockResolvedValue(null)
    renderHook(() => useWebviewRecovery())
    await waitFor(() => expect(invokeMock).toHaveBeenCalled())
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('confirms Copy Memory Report', async () => {
    invokeMock.mockResolvedValue(null)
    renderHook(() => useWebviewRecovery())
    await waitFor(() =>
      expect(menuListeners.has('memory-report-copied')).toBe(true)
    )
    menuListeners.get('memory-report-copied')?.(true)
    expect(toast.success).toHaveBeenCalledWith('Memory report copied')
    menuListeners.get('memory-report-copied')?.(false)
    expect(toast.error).toHaveBeenCalled()
  })

  it('does nothing in web access', () => {
    nativeMock.mockReturnValue(false)
    renderHook(() => useWebviewRecovery())
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
