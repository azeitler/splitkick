import { useSyncExternalStore } from 'react'
import type { ChartTheme } from './vega-chart'

// ThemeProvider sets `dark` / `light` on <html>, also for the system theme.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => observer.disconnect()
}

function getTheme(): ChartTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** The resolved app theme, kept in sync with the class on <html>. */
export function useDocumentTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, getTheme, () => 'light')
}
