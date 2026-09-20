import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import { BrowserTabContent } from './BrowserTabContent'
import { useBrowserStore } from '@/store/browser-store'
import type * as Transport from '@/lib/transport'

const browserBackendMock = vi.hoisted(() => ({
  create: vi.fn(),
  setBounds: vi.fn(),
  setVisible: vi.fn(),
  hasActive: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/hooks/useBrowserPane', () => ({
  browserBackend: browserBackendMock,
  openUrlInEmbeddedBrowser: vi.fn(),
}))

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onScaleChanged: vi.fn().mockResolvedValue(vi.fn()),
  }),
}))

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

describe('BrowserTabContent', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    browserBackendMock.create.mockResolvedValue(undefined)
    browserBackendMock.setBounds.mockResolvedValue(undefined)
    browserBackendMock.setVisible.mockResolvedValue(undefined)
    browserBackendMock.hasActive.mockResolvedValue(false)
    browserBackendMock.close.mockResolvedValue(undefined)
    invokeMock.mockResolvedValue('')
    useBrowserStore.setState({ tabs: {}, activeTabIds: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('does not park a tab on unmount after the backend tab is already closed', async () => {
    const { unmount } = render(
      <BrowserTabContent tabId="tab-1" isActive={false} />
    )

    unmount()

    await waitFor(() => {
      expect(browserBackendMock.hasActive).toHaveBeenCalledWith('tab-1')
    })
    expect(browserBackendMock.setBounds).not.toHaveBeenCalled()
    expect(browserBackendMock.setVisible).not.toHaveBeenCalled()
  })

  it('renders a local text file itself instead of creating a webview', async () => {
    invokeMock.mockResolvedValue('# Notes')
    const tabId = useBrowserStore
      .getState()
      .addTab('wt-1', 'file:///repo/NOTES.md')

    render(<BrowserTabContent tabId={tabId} isActive />)

    await screen.findByText('Notes')
    expect(browserBackendMock.create).not.toHaveBeenCalled()
  })

  it('gives a local HTML page to the webview', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0)
      return 1
    })
    const tabId = useBrowserStore
      .getState()
      .addTab('wt-1', 'file:///repo/index.html')

    render(<BrowserTabContent tabId={tabId} isActive />)

    await waitFor(() => {
      expect(browserBackendMock.create).toHaveBeenCalledWith(
        tabId,
        'file:///repo/index.html',
        expect.anything()
      )
    })
  })
})
