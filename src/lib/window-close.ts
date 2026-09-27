/**
 * Reliable app-window quit helpers for the native shell.
 *
 * Windows (and some Linux setups) do not reliably finish a close when an async
 * `onCloseRequested` handler only "falls through". Call `preventDefault()`
 * synchronously, then `destroy()` once the quit is allowed.
 *
 * During loading / reconnect the backend may be unreachable. Never block quit
 * on a hung `has_running_sessions` call — fail open after a short timeout, and
 * skip the check entirely when neither native IPC nor another backend is
 * available.
 */

import { hasBackend, isNativeApp } from './environment'
import { logger } from './logger'
import { invoke } from './transport'
import { flushUIStateBeforeTeardown } from './ui-state-teardown'

export const SESSION_CHECK_TIMEOUT_MS = 1500

export async function destroyAppWindow(): Promise<void> {
  // `destroy()` tears the webview down without a page unload, so neither
  // `beforeunload` nor `pagehide` fires and a debounced UI-state write made in
  // the last 500 ms would be lost — the session you switched to just before
  // quitting would not be the one that reopens. Wait for that write first, and
  // never let a failed one keep the window open.
  try {
    await flushUIStateBeforeTeardown()
  } catch (error) {
    logger.warn('UI state save before quit failed', { error })
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().destroy()
}

/**
 * Returns whether any sessions are actively running.
 * Fail-open: false when the backend is unavailable or the check times out.
 */
export async function checkHasRunningSessions(
  timeoutMs: number = SESSION_CHECK_TIMEOUT_MS
): Promise<boolean> {
  if (!isNativeApp() && !hasBackend()) return false

  try {
    return await Promise.race([
      invoke<boolean>('has_running_sessions'),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      ),
    ])
  } catch {
    return false
  }
}

/**
 * Attempt to quit the native app window.
 * Shows the quit confirmation dialog when production sessions are running;
 * otherwise destroys the window (bypasses async close quirks on Windows).
 */
export async function requestAppQuit(): Promise<void> {
  if (!isNativeApp()) return

  if (!import.meta.env.DEV) {
    const hasRunning = await checkHasRunningSessions()
    if (hasRunning) {
      window.dispatchEvent(new CustomEvent('quit-confirmation-requested'))
      return
    }
  }

  await destroyAppWindow()
}
