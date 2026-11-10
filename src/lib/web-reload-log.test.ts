import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nativeApp = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/environment', () => ({
  isNativeApp: () => nativeApp.value,
}))

import {
  classifyStart,
  clearWebReloadLog,
  countStarts,
  getWebReloadLog,
  installWebReloadLog,
  reloadApp,
} from './web-reload-log'

const KEY = 'jean:web-reload-log'

// The test setup stubs localStorage; give it a memory store here.
const store = new Map<string, string>()
vi.mocked(localStorage.getItem).mockImplementation(
  key => store.get(key) ?? null
)
vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
  store.set(key, String(value))
})
vi.mocked(localStorage.removeItem).mockImplementation(key => {
  store.delete(key)
})
vi.mocked(localStorage.clear).mockImplementation(() => store.clear())

describe('classifyStart', () => {
  const now = 1_000_000

  it('is first without an earlier page event', () => {
    expect(classifyStart({}, 'navigate', now)).toEqual({
      kind: 'first',
      gapMs: null,
    })
  })

  it('counts a page that ended in the background', () => {
    expect(
      classifyStart(
        { lastEvent: { type: 'hidden', at: now - 90_000 } },
        'navigate',
        now
      )
    ).toEqual({ kind: 'background-end', gapMs: 90_000 })
  })

  it('tells a browser reload from a new start after an unload', () => {
    const lastEvent = { type: 'unload' as const, at: now - 500 }
    expect(classifyStart({ lastEvent }, 'reload', now).kind).toBe('reload')
    expect(classifyStart({ lastEvent }, 'navigate', now).kind).toBe('start')
  })

  it('is a foreground end when the page ended on screen', () => {
    expect(
      classifyStart({ lastEvent: { type: 'visible', at: now } }, null, now).kind
    ).toBe('foreground-end')
  })

  it('prefers a fresh app reload mark, and ignores a stale one', () => {
    const lastEvent = { type: 'unload' as const, at: now - 100 }
    expect(
      classifyStart(
        { lastEvent, appReload: { at: now - 100, reason: 'new-version' } },
        'reload',
        now
      )
    ).toEqual({ kind: 'app-reload', gapMs: 100, reason: 'new-version' })
    expect(
      classifyStart(
        { lastEvent, appReload: { at: now - 120_000, reason: 'palette' } },
        'reload',
        now
      ).kind
    ).toBe('reload')
  })
})

describe('installWebReloadLog', () => {
  const reload = vi.fn()
  const originalLocation = window.location

  beforeEach(() => {
    localStorage.clear()
    nativeApp.value = false
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
    reload.mockReset()
  })

  it('does nothing in the native app', () => {
    nativeApp.value = true
    expect(installWebReloadLog()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('records a background end after the page was hidden', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ lastEvent: { type: 'hidden', at: 1_000 }, entries: [] })
    )
    const entry = installWebReloadLog(61_000)
    expect(entry).toMatchObject({ kind: 'background-end', gapMs: 60_000 })
    expect(getWebReloadLog()).toHaveLength(1)
    expect(countStarts(getWebReloadLog(), 'background-end', 0)).toBe(1)
  })

  it('keeps "unload" when "hidden" follows pagehide (a reload)', () => {
    installWebReloadLog(1_000)
    window.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: false })
    )
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    expect(JSON.parse(store.get(KEY) ?? '{}').lastEvent.type).toBe('unload')
  })

  it('marks reloads that the app starts', () => {
    reloadApp('palette')
    expect(reload).toHaveBeenCalledOnce()
    const entry = installWebReloadLog()
    expect(entry).toMatchObject({ kind: 'app-reload', reason: 'palette' })
    // The mark is used once.
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').appReload).toBe(
      undefined
    )
  })

  it('keeps at most 200 entries and clears them', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        entries: Array.from({ length: 200 }, (_, at) => ({
          at,
          kind: 'start',
          gapMs: 0,
          navigationType: 'navigate',
        })),
      })
    )
    installWebReloadLog(5_000)
    const entries = getWebReloadLog()
    expect(entries).toHaveLength(200)
    expect(entries.at(-1)?.at).toBe(5_000)
    clearWebReloadLog()
    expect(getWebReloadLog()).toEqual([])
  })

  it('survives broken storage content', () => {
    localStorage.setItem(KEY, '{not json')
    expect(installWebReloadLog(1)).toMatchObject({ kind: 'first' })
  })
})
