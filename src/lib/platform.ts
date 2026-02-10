import { isNativeApp } from './environment'

export const isMacOS = navigator.platform.includes('Mac')
export const isWindows = navigator.platform.includes('Win')

export async function openExternal(url: string): Promise<void> {
  if (isNativeApp()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    window.open(url, '_blank')
  }
}

/**
 * Returns the correct modifier key symbol based on platform and environment.
 * Mac native app uses ⌘, Mac web uses ⌃ (Ctrl works in browser, Cmd is intercepted).
 */
export const getModifierSymbol = (): string => {
  if (!isMacOS) return 'Ctrl'
  return isNativeApp() ? '⌘' : '⌃'
}
