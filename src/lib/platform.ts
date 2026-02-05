import { isNativeApp } from './environment'

export const isMacOS = navigator.platform.includes('Mac')
export const isWindows = navigator.platform.includes('Win')

/**
 * Returns the correct modifier key symbol based on platform and environment.
 * Mac native app uses ⌘, Mac web uses ⌃ (Ctrl works in browser, Cmd is intercepted).
 */
export const getModifierSymbol = (): string => {
  if (!isMacOS) return 'Ctrl'
  return isNativeApp() ? '⌘' : '⌃'
}
