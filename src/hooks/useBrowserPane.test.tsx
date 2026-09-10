import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  openUrlInEmbeddedBrowser,
  resolveBrowserSurfaceTarget,
  useBrowserTabActions,
} from './useBrowserPane'
import { useBrowserStore } from '@/store/browser-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', () => ({
  invoke: invokeMock,
  listen: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
}))

describe('useBrowserTabActions grab integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.className = ''
    invokeMock.mockResolvedValue(undefined)
  })

  it('invokes the native React Grab injection command for the active tab', async () => {
    document.documentElement.classList.add('dark')
    const { result } = renderHook(() => useBrowserTabActions('tab-1'))

    await result.current.enableGrab()

    expect(invokeMock).toHaveBeenCalledWith('browser_enable_grab', {
      tabId: 'tab-1',
      theme: 'dark',
    })
  })
})

describe('openUrlInEmbeddedBrowser', () => {
  const FILE_URL = 'file:///Users/dev/site/index.html'

  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockResolvedValue(undefined)
    useBrowserStore.setState({
      tabs: {},
      activeTabIds: {},
      sidePaneOpen: {},
      modalOpen: {},
      bottomPanelOpen: {},
    })
    useChatStore.setState({ activeWorktreeId: 'wt-1' })
    useUIStore.setState({
      sessionChatModalOpen: false,
      sessionChatModalWorktreeId: null,
    })
  })

  it('opens a new tab in the side pane of the active worktree', async () => {
    expect(await openUrlInEmbeddedBrowser(FILE_URL)).toBe(true)

    const state = useBrowserStore.getState()
    const tabs = state.tabs['wt-1'] ?? []
    expect(tabs.map(tab => tab.url)).toEqual([FILE_URL])
    expect(state.activeTabIds['wt-1']).toBe(tabs[0]?.id)
    expect(state.sidePaneOpen['wt-1']).toBe(true)
    // A new tab creates its webview on mount with the URL; no navigate call.
    expect(invokeMock).not.toHaveBeenCalledWith(
      'browser_navigate',
      expect.anything()
    )
  })

  it('reloads a tab that already shows the URL instead of adding another', async () => {
    const other = useBrowserStore.getState().addTab('wt-1', 'https://a.test')
    const existing = useBrowserStore.getState().addTab('wt-1', FILE_URL)
    useBrowserStore.getState().setActiveTab('wt-1', other)
    invokeMock.mockImplementation(async (command: string) =>
      command === 'has_active_browser_tab' ? true : undefined
    )

    await openUrlInEmbeddedBrowser(FILE_URL)

    const state = useBrowserStore.getState()
    expect(state.tabs['wt-1']).toHaveLength(2)
    expect(state.activeTabIds['wt-1']).toBe(existing)
    expect(invokeMock).toHaveBeenCalledWith('browser_navigate', {
      tabId: existing,
      url: FILE_URL,
    })
  })

  it('only activates a matching tab whose webview does not exist yet', async () => {
    const existing = useBrowserStore.getState().addTab('wt-1', FILE_URL)
    invokeMock.mockImplementation(async (command: string) =>
      command === 'has_active_browser_tab' ? false : undefined
    )

    await openUrlInEmbeddedBrowser(FILE_URL)

    expect(useBrowserStore.getState().activeTabIds['wt-1']).toBe(existing)
    expect(invokeMock).not.toHaveBeenCalledWith(
      'browser_navigate',
      expect.anything()
    )
  })

  it('uses the session modal drawer while the session modal is open', async () => {
    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'wt-2',
    })

    await openUrlInEmbeddedBrowser(FILE_URL)

    const state = useBrowserStore.getState()
    expect(state.tabs['wt-2']?.map(tab => tab.url)).toEqual([FILE_URL])
    expect(state.modalOpen['wt-2']).toBe(true)
    expect(state.sidePaneOpen['wt-2']).toBeFalsy()
  })

  it('returns false and opens nothing when no browser surface exists', async () => {
    useChatStore.setState({ activeWorktreeId: null })

    expect(resolveBrowserSurfaceTarget()).toBeNull()
    expect(await openUrlInEmbeddedBrowser(FILE_URL)).toBe(false)
    expect(useBrowserStore.getState().tabs).toEqual({})
  })
})
