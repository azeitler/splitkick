import { useEffect } from 'react'
import { isNativeApp } from '@/lib/environment'

/**
 * Apply the title-bar breadcrumb to the window it belongs to.
 *
 * The native title bar draws the breadcrumb itself (`hiddenTitle`), so the
 * window's own title is what the macOS Window menu, Mission Control and the
 * app switcher read. With one window per connection they would otherwise all
 * read "Jean". In a browser the same string is the tab title.
 */
export function useWindowTitle(title: string): void {
  useEffect(() => {
    if (!isNativeApp()) {
      document.title = title
      return
    }

    let cancelled = false
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        if (cancelled) return
        return getCurrentWindow().setTitle(title)
      })
      .catch(() => {
        // A title is cosmetic; never let it break the window.
      })

    return () => {
      cancelled = true
    }
  }, [title])
}
