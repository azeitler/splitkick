import { getActiveRemoteConnection } from './remote-connections'

/**
 * Environment detection utilities.
 *
 * - isNativeApp(): true only when running inside the Tauri desktop shell
 * - hasBackend(): true while Tauri IPC or the browser WebSocket is connected
 * - hasBackendTransport(): true when a backend transport is configured, even
 *   while the browser WebSocket is still opening
 *
 * Service queries should guard with hasBackendTransport(); mutations that
 * must run immediately should guard with hasBackend().
 * UI should use isNativeApp() for local shell features, isLocalBackend() for
 * "this machine's desktop shell", canOpenNativeApps() / canOpenInEditor() for
 * Finder/editor/terminal open actions and canPickLocalPaths() for native
 * pickers. The full action table is in docs/developer/remote-capabilities.md.
 */

/** Running inside the native Tauri desktop app with usable IPC.
 * Some mobile/web shells can expose a partial `__TAURI_INTERNALS__` object
 * without `invoke`; those must use the WebSocket transport instead. */
export const isNativeApp = (): boolean =>
  typeof window !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (window as any).__TAURI_INTERNALS__?.invoke === 'function'

/** Whether backend operations target this desktop app's local Jean core. */
export const isLocalBackend = (): boolean =>
  isNativeApp() && getActiveRemoteConnection() === null

/**
 * Whether this client runs on the same machine as the backend: the local
 * desktop backend, or a backend reached by a loopback address (Web Access
 * opened on `localhost`, a remote connection to `127.0.0.1`). A backend
 * behind a tunnel, LAN address or DNS name is on another machine, even when
 * the tunnel daemon itself talks to the server over loopback.
 */
export const isBackendOnThisMachine = (): boolean => {
  if (isLocalBackend()) return true
  if (typeof window === 'undefined') return false
  const remote = getActiveRemoteConnection()
  try {
    const host = remote
      ? new URL(remote.url).hostname
      : window.location.hostname
    return isLoopbackHost(host)
  } catch {
    return false
  }
}

const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host === '[::1]' ||
  host === '::1' ||
  /^127\.\d+\.\d+\.\d+$/.test(host)

/**
 * The backend host may launch apps (`nativeOpenAllowed` from `/api/init`):
 * the desktop app hosting Web Access, `--allow-native-open`, or WSL.
 * Kept separate from the user-facing check: a Finder window that opens on
 * the host only helps a user who sits at the host.
 */
let _nativeOpenAllowed = false

export const setNativeOpenAllowed = (allowed: boolean): void => {
  _nativeOpenAllowed = allowed
}

/**
 * Native open actions run on the remote host and the user sees them: the
 * host allows them AND this client is on that machine (see
 * `docs/developer/remote-capabilities.md`).
 */
export const isNativeOpenAllowed = (): boolean =>
  _nativeOpenAllowed && isBackendOnThisMachine()

/**
 * Show Reveal/Open in Finder, terminal, default app and git client for a
 * backend path: local desktop, or a remote host this client sits at.
 */
export const canOpenNativeApps = (): boolean =>
  isLocalBackend() || isNativeOpenAllowed()

/**
 * Native desktop shell connected to a remote Jean can open remote paths in the
 * local Zed CLI via `ssh://` when the remote cannot open apps for this user
 * (see `prepareRemoteEditorOpenArgs` and transport invoke routing).
 */
export const canOpenRemoteEditorLocally = (): boolean =>
  isNativeApp() &&
  getActiveRemoteConnection() !== null &&
  !isNativeOpenAllowed()

/**
 * Show Open in Editor: full host-native open, or remote Jean + local Zed CLI.
 * Finder/terminal still use `canOpenNativeApps()`.
 */
export const canOpenInEditor = (): boolean =>
  canOpenNativeApps() || canOpenRemoteEditorLocally()

/**
 * Use the native file/folder picker (Browse…). The dialog lists this
 * machine's disk, so it only fits the local backend; remote clients type
 * the path or use the backend's directory browser.
 */
export const canPickLocalPaths = (): boolean => isLocalBackend()

/** A backend is available (either Tauri IPC, WebSocket connection, or E2E mock). */
export const hasBackend = (): boolean => {
  if (isLocalBackend()) return true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window !== 'undefined' && (window as any).__JEAN_E2E_MOCK__)
    return true
  // In browser mode, check if we have WS connection info
  // (set when the transport connects)
  return _wsConnected
}

// Internal flag set by WsTransport when connected
let _wsConnected = false
let _webAccessEnabled = false
export const setWsConnected = (connected: boolean): void => {
  _wsConnected = connected
}

export const setWebAccessEnabled = (enabled: boolean): void => {
  _webAccessEnabled = enabled
}

/** Whether queries can use a configured backend transport.
 * Unlike hasBackend(), this stays true while web access is connecting so query
 * functions wait/fail instead of returning authoritative empty data. */
export const hasBackendTransport = (): boolean =>
  isLocalBackend() ||
  getActiveRemoteConnection() !== null ||
  _webAccessEnabled ||
  (typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!(window as any).__JEAN_E2E_MOCK__)
