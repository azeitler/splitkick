import { X, Minus, Maximize2, Maximize, Minimize2 } from 'lucide-react'
import type { AppCommand } from './types'
import { isNativeApp } from '@/lib/environment'

export const windowCommands: AppCommand[] = [
  {
    id: 'window-close',
    label: 'Close Window',
    description: 'Close the current window',
    icon: X,
    group: 'window',
    shortcut: '⌘+W',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.close()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to close window: ${message}`, 'error')
      }
    },
  },

  {
    id: 'window-minimize',
    label: 'Minimize Window',
    description: 'Minimize the current window',
    icon: Minus,
    group: 'window',
    shortcut: '⌘+M',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.minimize()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to minimize window: ${message}`, 'error')
      }
    },
  },

  {
    id: 'window-toggle-maximize',
    label: 'Toggle Maximize',
    description: 'Toggle window maximize state',
    icon: Maximize2,
    group: 'window',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.toggleMaximize()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to toggle maximize: ${message}`, 'error')
      }
    },
  },

  {
    id: 'window-fullscreen',
    label: 'Enter Fullscreen',
    description: 'Enter fullscreen mode',
    icon: Maximize,
    group: 'window',
    shortcut: 'F11',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.setFullscreen(true)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to enter fullscreen: ${message}`, 'error')
      }
    },
  },

  {
    id: 'window-exit-fullscreen',
    label: 'Exit Fullscreen',
    description: 'Exit fullscreen mode',
    icon: Minimize2,
    group: 'window',
    shortcut: 'Escape',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.setFullscreen(false)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to exit fullscreen: ${message}`, 'error')
      }
    },
  },
]
