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
