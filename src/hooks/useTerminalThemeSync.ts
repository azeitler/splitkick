import { useEffect, useMemo } from 'react'
import { useTheme } from '@/hooks/use-theme'
import { usePreferences } from '@/services/preferences'
import { setTerminalPreferences } from '@/lib/terminal-prefs'
import { resolveTerminalTheme } from '@/lib/terminal-theme'

/**
 * Push the user's terminal background preference to the terminals and repaint
 * open terminals whenever the preference (or the app theme, which Auto mode
 * tracks) changes. Goes through `terminal-prefs`, so the main window does not
 * load the terminal code.
 */
export function useTerminalThemeSync(): void {
  const { theme } = useTheme()
  const { data: preferences } = usePreferences()

  useEffect(() => {
    if (!preferences) return
    setTerminalPreferences({
      terminal_background: preferences.terminal_background,
      terminal_background_custom: preferences.terminal_background_custom,
    })
  }, [preferences, theme])
}

const FALLBACK_BG = '#1e1e1e'

function readCssBackground(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return FALLBACK_BG
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--background')
    .trim()
  return value || FALLBACK_BG
}

/**
 * Resolved terminal background color, reactive to preferences and app theme.
 * Use to paint container chrome (padding, drawers) so the terminal viewport
 * blends seamlessly into its surrounding box.
 */
export function useTerminalBackgroundColor(): string {
  const { theme } = useTheme()
  const { data: preferences } = usePreferences()

  return useMemo(() => {
    if (!preferences) return readCssBackground()
    return resolveTerminalTheme(
      {
        terminal_background: preferences.terminal_background,
        terminal_background_custom: preferences.terminal_background_custom,
      },
      () => ({
        background: readCssBackground(),
        foreground: '#fafafa',
        cursor: '#fafafa',
        selectionBackground: '#242424',
      })
    ).background
  }, [preferences, theme])
}
