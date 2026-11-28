/**
 * Whether this client can reach its backend.
 *
 * Only a WebSocket client (Web Access, a desktop window on a remote server)
 * can be offline; the local desktop app talks to its backend through IPC.
 */
import { useSyncExternalStore } from 'react'
import {
  isTransportConnected,
  usesWebSocketBackend,
  useWsConnectionStatus,
} from '@/lib/transport'

// The e2e mock transport always reports "connected". A test sets
// `__JEAN_E2E_MOCK__.offline` and dispatches `e2e:connection` on the mock's
// event emitter to play a dropped connection.
const E2E_CONNECTION_EVENT = 'e2e:connection'

function e2eMock(): { offline?: boolean; eventEmitter?: EventTarget } | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).__JEAN_E2E_MOCK__ ?? null
}

function subscribeE2e(callback: () => void): () => void {
  const emitter = e2eMock()?.eventEmitter
  emitter?.addEventListener(E2E_CONNECTION_EVENT, callback)
  return () => emitter?.removeEventListener(E2E_CONNECTION_EVENT, callback)
}

const getE2eOffline = () => !!e2eMock()?.offline

/** React hook: true while the backend is not reachable. */
export function useBackendOffline(): boolean {
  const connected = useWsConnectionStatus()
  const e2eOffline = useSyncExternalStore(subscribeE2e, getE2eOffline)
  return e2eOffline || (usesWebSocketBackend() && !connected)
}

/** Non-React check, same rule as `useBackendOffline`. */
export function isBackendOffline(): boolean {
  return getE2eOffline() || !isTransportConnected()
}

function subscribeNetwork(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

const getNetworkOffline = () =>
  typeof navigator !== 'undefined' && navigator.onLine === false

/**
 * React hook: true while this machine has no network, so the AI backends
 * (Claude, Codex, …) cannot reach their model APIs.
 *
 * Only for a local instance: there this machine runs the CLIs. A remote
 * client's network says nothing about the host's. `navigator.onLine` false is
 * a reliable sign of no network; true does not prove that the internet works
 * (https://developer.mozilla.org/docs/Web/API/Navigator/onLine).
 */
export function useModelsOffline(): boolean {
  const networkOffline = useSyncExternalStore(
    subscribeNetwork,
    getNetworkOffline
  )
  return networkOffline && !usesWebSocketBackend()
}
