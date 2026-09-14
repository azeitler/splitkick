/**
 * Connection windows — one native window per remote Jean instance.
 *
 * The main window always drives the local backend. Each remote connection gets
 * its own window, so switching costs a window focus instead of a full reload
 * of the single window. Web Access runs in one browsing context and has no
 * windows to open, so it keeps swapping the active connection in place.
 *
 * The Rust side (`src-tauri/src/connection_window.rs`) owns the window; it
 * focuses an existing one rather than opening a second for the same
 * connection, so there is nothing to track here.
 */

import { isNativeApp } from './environment'
import {
  LOCAL_CONNECTION_ID,
  markConnectionSwitch,
  selectConnection,
} from './remote-connections'
import { invoke } from './transport'

export async function openConnectionWindow(
  connectionId: string,
  title?: string
): Promise<void> {
  await invoke('open_connection_window', {
    connectionId,
    title: title ?? null,
  })
}

export async function focusMainWindow(): Promise<void> {
  await invoke('focus_main_window')
}

export async function closeConnectionWindow(
  connectionId: string
): Promise<void> {
  await invoke('close_connection_window', { connectionId })
}

/**
 * Bring a connection to the front.
 *
 * `reloadApp` is only used on the Web Access path; tests inject it there.
 */
export async function activateConnection(
  connectionId: string,
  reloadApp: () => void = () => window.location.reload()
): Promise<void> {
  if (!isNativeApp()) {
    markConnectionSwitch()
    selectConnection(connectionId)
    reloadApp()
    return
  }
  if (connectionId === LOCAL_CONNECTION_ID) {
    await focusMainWindow()
    return
  }
  await openConnectionWindow(connectionId)
}

/** Connection ids that currently have a window open. Empty in Web Access. */
export async function listConnectionWindows(): Promise<string[]> {
  if (!isNativeApp()) return []
  const open = await invoke<string[]>('list_connection_windows')
  return Array.isArray(open) ? open : []
}
