import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useSoftKeyboardOpen,
  useVisualViewportShell,
} from './useVisualViewportShell'

interface FakeVisualViewport {
  height: number
  offsetTop: number
  scale: number
  addEventListener: (type: string, cb: EventListener) => void
  removeEventListener: (type: string, cb: EventListener) => void
  dispatch: (type: string) => void
}

function installVisualViewport(height: number): FakeVisualViewport {
  const listeners = new Map<string, Set<EventListener>>()
  const vv: FakeVisualViewport = {
    height,
    offsetTop: 0,
    scale: 1,
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(cb)
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb)
    },
    dispatch(type) {
      for (const cb of listeners.get(type) ?? []) cb(new Event(type))
    },
  }
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: vv,
  })
  return vv
}

const root = document.documentElement

describe('useVisualViewportShell', () => {
  const originalInnerHeight = window.innerHeight
  let scrollTo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844,
    })
    scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: undefined,
    })
  })

  it('sets --app-height to the visible height', () => {
    installVisualViewport(844)
    const { unmount } = renderHook(() => useVisualViewportShell(true))
    expect(root.style.getPropertyValue('--app-height')).toBe('844px')
    expect(root.hasAttribute('data-keyboard-open')).toBe(false)
    unmount()
    expect(root.style.getPropertyValue('--app-height')).toBe('')
  })

  it('reports the keyboard and shrinks the shell when it opens', () => {
    const vv = installVisualViewport(844)
    renderHook(() => useVisualViewportShell(true))
    const open = renderHook(() => useSoftKeyboardOpen())
    expect(open.result.current).toBe(false)

    vv.height = 508
    act(() => {
      vv.dispatch('resize')
      vi.advanceTimersByTime(20)
    })
    expect(root.style.getPropertyValue('--app-height')).toBe('508px')
    expect(root.hasAttribute('data-keyboard-open')).toBe(true)
    expect(open.result.current).toBe(true)
  })

  it('ignores a small difference such as Safari toolbar collapse', () => {
    installVisualViewport(800)
    renderHook(() => useVisualViewportShell(true))
    const open = renderHook(() => useSoftKeyboardOpen())
    expect(open.result.current).toBe(false)
  })

  it('scrolls a leftover pan back to the top after the keyboard closes', () => {
    // iOS 26 can keep offsetTop > 0 after the keyboard is dismissed.
    const vv = installVisualViewport(844)
    renderHook(() => useVisualViewportShell(true))
    scrollTo.mockClear()

    vv.offsetTop = 40
    act(() => {
      window.dispatchEvent(new Event('focusout'))
      vi.advanceTimersByTime(300)
    })
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('leaves the layout alone while pinch-zoomed', () => {
    const vv = installVisualViewport(844)
    renderHook(() => useVisualViewportShell(true))
    vv.scale = 2
    vv.height = 422
    act(() => {
      vv.dispatch('resize')
      vi.advanceTimersByTime(20)
    })
    expect(root.style.getPropertyValue('--app-height')).toBe('844px')
  })

  it('does nothing when disabled', () => {
    installVisualViewport(508)
    renderHook(() => useVisualViewportShell(false))
    expect(root.style.getPropertyValue('--app-height')).toBe('')
  })
})
