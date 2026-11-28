import type { AppPreferences } from '@/types/preferences'

/**
 * The terminal background preference, outside `terminal-instances`.
 *
 * `terminal-instances` pulls in xterm and ghostty-web (the `terminal` chunk).
 * The main window sets this preference at start; keeping it here lets the
 * first screen load without the terminal code. `terminal-instances` reads it
 * and repaints its terminals on every change.
 */
export type TerminalBackgroundPrefs = Pick<
  AppPreferences,
  'terminal_background' | 'terminal_background_custom'
>

let prefs: TerminalBackgroundPrefs = {
  terminal_background: 'auto',
  terminal_background_custom: null,
}
const listeners = new Set<() => void>()

/** Store the preference and repaint open terminals (also on theme change). */
export function setTerminalPreferences(next: TerminalBackgroundPrefs): void {
  prefs = {
    terminal_background: next.terminal_background,
    terminal_background_custom: next.terminal_background_custom,
  }
  for (const listener of listeners) listener()
}

export function getTerminalPreferences(): TerminalBackgroundPrefs {
  return prefs
}

/** Called after each `setTerminalPreferences`. Returns the unsubscribe. */
export function onTerminalPreferencesChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
