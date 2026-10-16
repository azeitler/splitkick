import { useEffect, useSyncExternalStore } from 'react'

/**
 * Below this many CSS pixels between the layout and the visual viewport, the
 * difference is browser chrome (Safari's collapsing toolbar), not a keyboard.
 */
const KEYBOARD_THRESHOLD_PX = 120

let keyboardOpen = false
const listeners = new Set<() => void>()

function setKeyboardOpen(next: boolean) {
  if (next === keyboardOpen) return
  keyboardOpen = next
  for (const listener of listeners) listener()
}

/**
 * Size the app shell to the visible area and keep the page unscrolled.
 *
 * iOS Safari does not shrink the layout viewport (or `dvh`) for the soft
 * keyboard. It pans the visual viewport instead, which pushes the session
 * header off the top, and on iOS 26 the pan can stay after the keyboard closes
 * (`offsetTop > 0`), leaving a gap under the composer and the header under the
 * status bar. So the shell follows `visualViewport.height` through
 * `--app-height`, and any pan is scrolled back to 0. Every surface inside the
 * shell (chat, terminal) then sits above the keyboard without its own padding.
 *
 * Mount once, in the window root. Off in the native app, which resizes its
 * webview with the window.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
 */
export function useVisualViewportShell(enabled: boolean) {
  useEffect(() => {
    const vv = window.visualViewport
    if (!enabled || !vv) return

    const root = document.documentElement
    let raf = 0
    const timers: ReturnType<typeof setTimeout>[] = []

    const measure = () => {
      // Pinch zoom also shrinks the visual viewport; leave the layout alone.
      if (vv.scale > 1.01) return
      const height = Math.round(vv.height)
      root.style.setProperty('--app-height', `${height}px`)
      const open = window.innerHeight - height > KEYBOARD_THRESHOLD_PX
      root.toggleAttribute('data-keyboard-open', open)
      if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0)
      // Set the height before notifying, so subscribers measure the new layout.
      setKeyboardOpen(open)
    }

    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    // The keyboard animates for about 250ms and iOS does not always send a
    // final resize, so check again once it has settled.
    const scheduleSettled = () => {
      schedule()
      for (const t of timers.splice(0)) clearTimeout(t)
      timers.push(setTimeout(measure, 300), setTimeout(measure, 600))
    }

    measure()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('focusin', scheduleSettled)
    window.addEventListener('focusout', scheduleSettled)

    return () => {
      cancelAnimationFrame(raf)
      for (const t of timers) clearTimeout(t)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('focusin', scheduleSettled)
      window.removeEventListener('focusout', scheduleSettled)
      root.style.removeProperty('--app-height')
      root.removeAttribute('data-keyboard-open')
      setKeyboardOpen(false)
    }
  }, [enabled])
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether the soft keyboard is open, as measured by `useVisualViewportShell`. */
export function useSoftKeyboardOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => keyboardOpen,
    () => false
  )
}
