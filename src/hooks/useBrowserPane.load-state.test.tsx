import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBrowserEvents } from './useBrowserPane'
import { useBrowserStore } from '@/store/browser-store'

const listenMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: listenMock,
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
  isLocalBackend: () => true,
}))

type Handler = (event: { payload: unknown }) => void

const handlers = new Map<string, Handler>()

function emit(event: string, payload: unknown): void {
  handlers.get(event)?.({ payload })
}

/** The one tab every test drives, with its id. */
function addTab(url: string): string {
  useBrowserStore.getState().addTab('wt-1', url)
  const tabs = useBrowserStore.getState().tabs['wt-1'] ?? []
  return tabs[tabs.length - 1]?.id ?? ''
}

function tabState(tabId: string) {
  return (useBrowserStore.getState().tabs['wt-1'] ?? []).find(
    t => t.id === tabId
  )
}

describe('browser pane load state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    handlers.clear()
    listenMock.mockImplementation((event: string, handler: Handler) => {
      handlers.set(event, handler)
      return Promise.resolve(() => handlers.delete(event))
    })
    useBrowserStore.setState({
      tabs: {},
      activeTabIds: {},
      sidePaneOpen: {},
      modalOpen: {},
      bottomPanelOpen: {},
    })
    renderHook(() => useBrowserEvents())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops the spinner and reports an error when a load never finishes', () => {
    const url = 'file:///tmp/gone.html'
    const tabId = addTab(url)

    emit('browser:loading', { tabId, url })
    expect(tabState(tabId)?.isLoading).toBe(true)

    // No "loaded" event ever arrives — wry gives no failure callback.
    vi.advanceTimersByTime(20_000)

    expect(tabState(tabId)?.isLoading).toBe(false)
    expect(tabState(tabId)?.error).toContain(url)
  })

  it('treats a movie as loaded as soon as it starts', () => {
    const url = 'file:///tmp/clip.mp4'
    const tabId = addTab(url)

    // WebKit hands a movie to its player and reports the navigation failed,
    // so no "loaded" event follows. The tab must not spin, or later error.
    emit('browser:loading', { tabId, url })

    expect(tabState(tabId)?.isLoading).toBe(false)
    expect(tabState(tabId)?.error).toBeNull()

    vi.advanceTimersByTime(20_000)

    expect(tabState(tabId)?.error).toBeNull()
    expect(tabState(tabId)?.lastLoadedUrl).toBe(url)
  })

  it('clears the watchdog when the load does finish', () => {
    const url = 'file:///tmp/report.html'
    const tabId = addTab(url)

    emit('browser:loading', { tabId, url })
    emit('browser:loaded', { tabId, url })

    vi.advanceTimersByTime(20_000)

    expect(tabState(tabId)?.isLoading).toBe(false)
    expect(tabState(tabId)?.error).toBeNull()
  })
})
