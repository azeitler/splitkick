import { useSyncExternalStore } from 'react'
import { LOCAL_SERVER_ID } from '@/types/server-resource'
import { generateId } from './uuid'

export const LOCAL_CONNECTION_ID = LOCAL_SERVER_ID

const CONNECTIONS_KEY = 'jean-remote-connections'
const ACTIVE_CONNECTION_KEY = 'jean-active-connection'
const SWITCHING_CONNECTION_KEY = 'jean-switching-connection-at'
const LOCAL_DASHBOARD_ENABLED_KEY = 'jean-local-dashboard-enabled'

export interface RemoteConnection {
  id: string
  name: string
  url: string
  token: string
  /** Missing on legacy profiles; missing means enabled. */
  enabled?: boolean
  /** SSH user for local editors that open remote paths (Zed `ssh://`). */
  sshUser?: string
  /** SSH host/IP; falls back to Web Access URL hostname when omitted. */
  sshHost?: string
  /** SSH port (default 22 when omitted). */
  sshPort?: number
}

export interface RemoteConnectionInput {
  name: string
  url: string
  token: string
  sshUser?: string
  sshHost?: string
  sshPort?: number
}

/** Parse a user-entered SSH port string; empty → undefined. Throws on invalid. */
export function parseOptionalSshPort(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SSH port must be an integer between 1 and 65535.')
  }
  return port
}

/** Label prefix of a connection window. Mirrors `REMOTE_LABEL_PREFIX` in
 * `src-tauri/src/connection_window.rs`. */
export const CONNECTION_WINDOW_LABEL_PREFIX = 'remote-'

/**
 * The connection this window is pinned to, or null in the main window.
 *
 * Rust opens a connection window at `index.html?connection=<id>`. This value
 * has to be readable synchronously while the module loads, because
 * `getActiveRemoteConnection()` is called from synchronous call sites all over
 * the app — a query parameter is the only channel that qualifies.
 *
 * The window label is a second source, so the pin survives a
 * `history.replaceState` (`transport.ts` uses one to strip `?token=`). Losing
 * the pin would point a remote window at the local backend.
 */
function readWindowConnection(): string | null {
  if (typeof window === 'undefined') return null
  const search = window.location?.search
  const fromUrl = search
    ? new URLSearchParams(search).get('connection')
    : null
  if (fromUrl) return fromUrl
  const label = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        metadata?: { currentWindow?: { label?: string } }
      }
    }
  ).__TAURI_INTERNALS__?.metadata?.currentWindow?.label
  return typeof label === 'string' &&
    label.startsWith(CONNECTION_WINDOW_LABEL_PREFIX)
    ? label.slice(CONNECTION_WINDOW_LABEL_PREFIX.length)
    : null
}

const subscribers = new Set<() => void>()
let connectionsSnapshot: RemoteConnection[] = readConnections()
const windowConnection = readWindowConnection()

/** Whether this window was opened for one remote connection. */
export function isConnectionWindow(): boolean {
  return windowConnection !== null
}

/** Inlined rather than imported from `environment.ts`, which imports this file. */
function isNativeShell(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } })
      .__TAURI_INTERNALS__?.invoke === 'function'
  )
}

function initialActiveConnection(): string {
  // The desktop shell gives every remote a window of its own, so the main
  // window is always local and never reads the saved id. Web Access has no
  // windows to open and still swaps the connection in place.
  if (isNativeShell()) return LOCAL_CONNECTION_ID
  const saved = storage()?.getItem(ACTIVE_CONNECTION_KEY) || LOCAL_CONNECTION_ID
  return saved === LOCAL_CONNECTION_ID ||
    connectionsSnapshot.some(connection => connection.id === saved)
    ? saved
    : LOCAL_CONNECTION_ID
}

// A pinned id is deliberately not checked against the saved list. Falling back
// to `local` would make a window whose connection was deleted drive the local
// machine; `App.tsx` closes the window instead.
let activeConnectionSnapshot = windowConnection ?? initialActiveConnection()
let localDashboardEnabledSnapshot =
  storage()?.getItem(LOCAL_DASHBOARD_ENABLED_KEY) !== 'false'

function storage(): Storage | null {
  return typeof globalThis.localStorage === 'undefined'
    ? null
    : globalThis.localStorage
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeOptionalPort(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value < 1 || value > 65535) return undefined
  return value
}

function normalizeConnection(item: unknown): RemoteConnection | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.token !== 'string'
  ) {
    return null
  }

  const connection: RemoteConnection = {
    id: record.id,
    name: record.name,
    url: record.url,
    token: record.token,
    enabled: record.enabled !== false,
  }

  const sshUser = normalizeOptionalString(record.sshUser)
  const sshHost = normalizeOptionalString(record.sshHost)
  const sshPort = normalizeOptionalPort(record.sshPort)
  if (sshUser) connection.sshUser = sshUser
  if (sshHost) connection.sshHost = sshHost
  if (sshPort) connection.sshPort = sshPort

  return connection
}

function readConnections(): RemoteConnection[] {
  const raw = storage()?.getItem(CONNECTIONS_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeConnection)
      .filter((item): item is RemoteConnection => item !== null)
  } catch {
    return []
  }
}

function sshFieldsFromInput(input: RemoteConnectionInput): {
  sshUser?: string
  sshHost?: string
  sshPort?: number
} {
  const fields: {
    sshUser?: string
    sshHost?: string
    sshPort?: number
  } = {}
  const sshUser = normalizeOptionalString(input.sshUser)
  const sshHost = normalizeOptionalString(input.sshHost)
  const sshPort = normalizeOptionalPort(input.sshPort)
  if (sshUser) fields.sshUser = sshUser
  if (sshHost) fields.sshHost = sshHost
  // Only persist non-default ports; 22 is implied when omitted.
  if (sshPort && sshPort !== 22) fields.sshPort = sshPort
  return fields
}

function writeConnections(connections: RemoteConnection[]): void {
  connectionsSnapshot = connections
  storage()?.setItem(CONNECTIONS_KEY, JSON.stringify(connections))
  for (const subscriber of subscribers) subscriber()
}

export function parseRemoteConnectionInput(
  rawUrl: string,
  rawToken: string
): { url: string; token: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Enter an HTTP or HTTPS URL.')
  }

  const token =
    rawToken.trim() || parsed.searchParams.get('token')?.trim() || ''
  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')

  return { url: parsed.toString().replace(/\/$/, ''), token }
}

export function getRemoteConnections(): RemoteConnection[] {
  return connectionsSnapshot
}

export function addRemoteConnection(
  input: RemoteConnectionInput
): RemoteConnection {
  const normalized = parseRemoteConnectionInput(input.url, input.token)
  const connection: RemoteConnection = {
    id: generateId(),
    name: input.name.trim() || new URL(normalized.url).hostname,
    enabled: true,
    ...normalized,
    ...sshFieldsFromInput(input),
  }
  writeConnections([...getRemoteConnections(), connection])
  return connection
}

export function updateRemoteConnection(
  id: string,
  input: RemoteConnectionInput
): RemoteConnection {
  const normalized = parseRemoteConnectionInput(input.url, input.token)
  const existing = getRemoteConnections().find(
    connection => connection.id === id
  )
  if (!existing) {
    throw new Error('Remote connection not found.')
  }
  const updated: RemoteConnection = {
    id,
    name: input.name.trim() || new URL(normalized.url).hostname,
    enabled: existing.enabled !== false,
    ...normalized,
    ...sshFieldsFromInput(input),
  }
  const connections = getRemoteConnections()
  writeConnections(
    connections.map(connection => (connection.id === id ? updated : connection))
  )
  return updated
}

export function getEnabledServerConnections(): RemoteConnection[] {
  return getRemoteConnections().filter(
    connection => connection.enabled !== false
  )
}

export function setRemoteConnectionEnabled(id: string, enabled: boolean): void {
  const connections = getRemoteConnections()
  if (!connections.some(connection => connection.id === id)) {
    throw new Error('Remote connection not found.')
  }
  writeConnections(
    connections.map(connection =>
      connection.id === id ? { ...connection, enabled } : connection
    )
  )
  if (!enabled && getActiveConnectionId() === id) {
    selectConnection(LOCAL_CONNECTION_ID)
  }
}

export function getLocalDashboardEnabled(): boolean {
  return localDashboardEnabledSnapshot
}

export function setLocalDashboardEnabled(enabled: boolean): void {
  storage()?.setItem(LOCAL_DASHBOARD_ENABLED_KEY, String(enabled))
  if (localDashboardEnabledSnapshot === enabled) return
  localDashboardEnabledSnapshot = enabled
  for (const subscriber of subscribers) subscriber()
}

export function removeRemoteConnection(id: string): void {
  writeConnections(
    getRemoteConnections().filter(connection => connection.id !== id)
  )
  if (getActiveConnectionId() === id) selectConnection(LOCAL_CONNECTION_ID)
}

export function getActiveConnectionId(): string {
  return activeConnectionSnapshot
}

export function getActiveRemoteConnection(): RemoteConnection | null {
  const activeId = getActiveConnectionId()
  if (activeId === LOCAL_CONNECTION_ID) return null
  return (
    getRemoteConnections().find(connection => connection.id === activeId) ??
    null
  )
}

export function selectConnection(id: string): void {
  // A connection window is pinned by its URL. It must never rewrite the key
  // that decides which backend the main window talks to.
  if (windowConnection !== null) return
  const selected =
    id === LOCAL_CONNECTION_ID ||
    getRemoteConnections().some(connection => connection.id === id)
      ? id
      : LOCAL_CONNECTION_ID
  activeConnectionSnapshot = selected
  storage()?.setItem(ACTIVE_CONNECTION_KEY, selected)
  for (const subscriber of subscribers) subscriber()
}

/** Native Jean always uses its local core; remote profiles are parallel adapters. */
export function selectLocalConnectionForNativeClient(native: boolean): void {
  if (native && getActiveConnectionId() !== LOCAL_CONNECTION_ID) {
    selectConnection(LOCAL_CONNECTION_ID)
  }
}

export function markConnectionSwitch(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(SWITCHING_CONNECTION_KEY, String(Date.now()))
  }
}

export function isConnectionSwitchPending(): boolean {
  if (typeof window === 'undefined') return false
  const switchedAt = Number(
    window.sessionStorage.getItem(SWITCHING_CONNECTION_KEY) ?? 0
  )
  return switchedAt > 0 && Date.now() - switchedAt < 30_000
}

export function clearConnectionSwitch(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(SWITCHING_CONNECTION_KEY)
  }
}

export function useRemoteConnections(): RemoteConnection[] {
  return useSyncExternalStore(
    callback => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    () => connectionsSnapshot,
    () => []
  )
}

/**
 * The active remote connection, or null while the backend is local.
 *
 * Safe as a `useSyncExternalStore` snapshot: `getRemoteConnections()` returns
 * the cached array, so the found connection keeps a stable reference until a
 * write notifies the subscribers.
 */
export function useActiveRemoteConnection(): RemoteConnection | null {
  return useSyncExternalStore(
    callback => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    getActiveRemoteConnection,
    () => null
  )
}

export function useActiveConnectionId(): string {
  return useSyncExternalStore(
    callback => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    () => activeConnectionSnapshot,
    () => LOCAL_CONNECTION_ID
  )
}

/**
 * The remote the desktop shell was on before connection windows existed.
 *
 * Read and cleared once, so the first start after the update reopens that
 * remote in a window of its own instead of dropping the user on local.
 */
export function takeMigratedRemoteConnectionId(): string | null {
  if (!isNativeShell() || windowConnection !== null) return null
  const saved = storage()?.getItem(ACTIVE_CONNECTION_KEY)
  storage()?.removeItem(ACTIVE_CONNECTION_KEY)
  return saved && saved !== LOCAL_CONNECTION_ID ? saved : null
}

export function useLocalDashboardEnabled(): boolean {
  return useSyncExternalStore(
    callback => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    () => localDashboardEnabledSnapshot,
    () => true
  )
}

export function subscribeRemoteConnections(callback: () => void): () => void {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}
