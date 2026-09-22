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

  describe('webview visibility at creation', () => {
    const OFFSCREEN = { x: -100000, y: -100000, width: 1, height: 1 }
    const HTML = 'file:///repo/index.html'

    beforeEach(() => {
      // Let the stable-frame detector run, so commit() is reached.
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        setTimeout(() => cb(0), 0)
        return 1
      })
    })

    it('creates an inactive tab parked and hidden, so it cannot cover the active one', async () => {
      // The bug: a new child webview is visible, and nothing hid an inactive
      // one. Over a text tab, which has no webview of its own, it showed.
      const tabId = useBrowserStore.getState().addTab('wt-1', HTML)

      render(<BrowserTabContent tabId={tabId} isActive={false} />)

      await waitFor(() =>
        expect(browserBackendMock.setVisible).toHaveBeenCalledWith(tabId, false)
      )
      expect(browserBackendMock.create).toHaveBeenCalledWith(
        tabId,
        HTML,
        OFFSCREEN
      )
      expect(browserBackendMock.setVisible).not.toHaveBeenCalledWith(
        tabId,
        true
      )
    })

    it('parks an existing webview of a tab that mounts inactive', async () => {
      browserBackendMock.hasActive.mockResolvedValue(true)
      const tabId = useBrowserStore.getState().addTab('wt-1', HTML)

      render(<BrowserTabContent tabId={tabId} isActive={false} />)

      await waitFor(() =>
        expect(browserBackendMock.setVisible).toHaveBeenCalledWith(tabId, false)
      )
      expect(browserBackendMock.setBounds).toHaveBeenCalledWith(
        tabId,
        OFFSCREEN
      )
      expect(browserBackendMock.setVisible).not.toHaveBeenCalledWith(
        tabId,
        true
      )
    })

    it('shows a tab that became active while its webview was being created', async () => {
      let finishCreate: () => void = () => undefined
      browserBackendMock.create.mockImplementation(
        () => new Promise<void>(resolve => (finishCreate = resolve))
      )
      const tabId = useBrowserStore.getState().addTab('wt-1', HTML)

      const { rerender } = render(
        <BrowserTabContent tabId={tabId} isActive={false} />
      )
      await waitFor(() => expect(browserBackendMock.create).toHaveBeenCalled())

      rerender(<BrowserTabContent tabId={tabId} isActive />)
      finishCreate()

      await waitFor(() =>
        expect(browserBackendMock.setVisible).toHaveBeenCalledWith(tabId, true)
      )
      // Moved out of the parking spot to the pane before it is shown.
      const bounds = browserBackendMock.setBounds.mock.calls.map(c => c[1])
      expect(bounds.at(-1)).not.toEqual(OFFSCREEN)
    })

    it('parks a webview whose tab body unmounted while it was being created', async () => {
      // Web tab → text tab in one step: the body unmounts mid-create, and
      // its cleanup found no webview to park yet.
      let finishCreate: () => void = () => undefined
      browserBackendMock.create.mockImplementation(
        () => new Promise<void>(resolve => (finishCreate = resolve))
      )
      const tabId = useBrowserStore.getState().addTab('wt-1', HTML)

      const { unmount } = render(<BrowserTabContent tabId={tabId} isActive />)
      await waitFor(() => expect(browserBackendMock.create).toHaveBeenCalled())

      unmount()
      finishCreate()

      await waitFor(() =>
        expect(browserBackendMock.setVisible).toHaveBeenCalledWith(tabId, false)
      )
      expect(browserBackendMock.setVisible).not.toHaveBeenCalledWith(
        tabId,
        true
      )
    })
  })
})
