import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { openUrlInWorktreeBrowser, useBrowserEvents } from './useBrowserPane'
import { useBrowserStore } from '@/store/browser-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { BrowserOpenUrlEvent } from '@/types/browser'

const { invokeMock, listenMock, localBackend } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  localBackend: { value: true },
}))

vi.mock('@/lib/transport', () => ({ invoke: invokeMock, listen: listenMock }))
vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
  isLocalBackend: () => localBackend.value,
}))

function resetStores() {
  useBrowserStore.setState({
    tabs: {},
    activeTabIds: {},
    sidePaneOpen: {},
    modalOpen: {},
    bottomPanelOpen: {},
  })
  useChatStore.setState({ activeWorktreeId: 'wt-visible' })
  useUIStore.setState({
    sessionChatModalOpen: false,
    sessionChatModalWorktreeId: null,
  })
}

function tabUrls(worktreeId: string): string[] {
  return (useBrowserStore.getState().tabs[worktreeId] ?? []).map(tab => tab.url)
}

describe('openUrlInWorktreeBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockResolvedValue(false)
    resetStores()
  })

  it('opens the page on screen when the worktree is visible', async () => {
    await openUrlInWorktreeBrowser('wt-visible', 'http://localhost:5173/')

    expect(tabUrls('wt-visible')).toEqual(['http://localhost:5173/'])
    expect(useBrowserStore.getState().sidePaneOpen['wt-visible']).toBe(true)
  })

  it('parks the tab in a worktree that is not on screen, once', async () => {
    await openUrlInWorktreeBrowser('wt-other', 'https://example.com/')
    await openUrlInWorktreeBrowser('wt-other', 'https://example.com/')

    expect(tabUrls('wt-other')).toEqual(['https://example.com/'])
    expect(useBrowserStore.getState().sidePaneOpen['wt-other']).toBe(true)
    expect(tabUrls('wt-visible')).toEqual([])
  })
})

describe('browser:open-url event', () => {
  let handler: (event: { payload: BrowserOpenUrlEvent }) => void

  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockResolvedValue(false)
    localBackend.value = true
    resetStores()
    listenMock.mockImplementation((name: string, callback: typeof handler) => {
      if (name === 'browser:open-url') handler = callback
      return Promise.resolve(() => undefined)
    })
    renderHook(() => useBrowserEvents())
  })

  it('opens web URLs and local file paths from the MCP tool', async () => {
    handler({
      payload: { worktreeId: 'wt-visible', url: 'https://example.com/' },
    })
    handler({
      payload: { worktreeId: 'wt-visible', path: '/tmp/my report.html' },
    })

    await vi.waitFor(() =>
      expect(tabUrls('wt-visible')).toEqual([
        'https://example.com/',
        'file:///tmp/my%20report.html',
      ])
    )
  })

  it('ignores file paths from a remote backend', async () => {
    localBackend.value = false

    handler({ payload: { worktreeId: 'wt-visible', path: '/tmp/report.html' } })
    await Promise.resolve()

    expect(tabUrls('wt-visible')).toEqual([])
  })
})
