import { describe, expect, it, vi } from 'vitest'
import {
  getTerminalPreferences,
  onTerminalPreferencesChange,
  setTerminalPreferences,
} from './terminal-prefs'

describe('terminal-prefs', () => {
  it('stores the preference and tells the terminals to repaint', () => {
    const repaint = vi.fn()
    const unsubscribe = onTerminalPreferencesChange(repaint)

    setTerminalPreferences({
      terminal_background: 'custom',
      terminal_background_custom: '#101010',
    })

    expect(getTerminalPreferences()).toEqual({
      terminal_background: 'custom',
      terminal_background_custom: '#101010',
    })
    expect(repaint).toHaveBeenCalledTimes(1)

    unsubscribe()
    setTerminalPreferences({
      terminal_background: 'auto',
      terminal_background_custom: null,
    })
    expect(repaint).toHaveBeenCalledTimes(1)
  })
})
