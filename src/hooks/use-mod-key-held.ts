import { useEffect, useState } from 'react'
import { isModKeyEvent } from '@/types/keybindings'

/**
 * Whether the app's "mod" key (⌘ in the macOS app, Ctrl elsewhere) is held.
 * Shortcut hints such as the session tabs' ⌘1–⌘9 appear only then, as in
 * macOS apps. Resets when the window loses focus, which swallows the keyup.
 */
export function useModKeyHeld(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const update = (event: KeyboardEvent) => setHeld(isModKeyEvent(event))
    const reset = () => setHeld(false)
    window.addEventListener('keydown', update, true)
    window.addEventListener('keyup', update, true)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', update, true)
      window.removeEventListener('keyup', update, true)
      window.removeEventListener('blur', reset)
    }
  }, [])

  return held
}
