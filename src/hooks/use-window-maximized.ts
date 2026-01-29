import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Hook to track whether the current window is maximized.
 * Useful for adjusting UI elements like border radius when maximized.
 */
export function useWindowMaximized() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const appWindow = getCurrentWindow()

    // Check initial state
    appWindow
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => {})

    // Listen for resize events to update maximized state
    let unlisten: (() => void) | null = null
    appWindow
      .onResized(async () => {
        try {
          const maximized = await appWindow.isMaximized()
          setIsMaximized(maximized)
        } catch {
          // ignore
        }
      })
      .then(fn => {
        unlisten = fn
      })

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  return isMaximized
}
