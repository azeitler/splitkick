import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ ws: true, connected: true }))

vi.mock('@/lib/transport', () => ({
  usesWebSocketBackend: () => transport.ws,
  useWsConnectionStatus: () => transport.connected,
  isTransportConnected: () => !transport.ws || transport.connected,
}))

import {
  isBackendOffline,
  useBackendOffline,
  useModelsOffline,
} from './backend-online'

function setNavigatorOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
  act(() => void window.dispatchEvent(new Event(online ? 'online' : 'offline')))
}

describe('backend-online', () => {
  beforeEach(() => {
    transport.ws = true
    transport.connected = true
    setNavigatorOnline(true)
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__JEAN_E2E_MOCK__
  })

  describe('the backend (Web Access, a remote window)', () => {
    it('is reachable while the socket is connected', () => {
      expect(renderHook(() => useBackendOffline()).result.current).toBe(false)
      expect(isBackendOffline()).toBe(false)
    })

    it('is offline while the socket is down', () => {
      transport.connected = false
      expect(renderHook(() => useBackendOffline()).result.current).toBe(true)
      expect(isBackendOffline()).toBe(true)
    })

    // The local desktop app talks to its backend through IPC.
    it('is never offline for the local desktop app', () => {
      transport.ws = false
      transport.connected = false
      expect(renderHook(() => useBackendOffline()).result.current).toBe(false)
      expect(isBackendOffline()).toBe(false)
    })

    it('follows the e2e switch, so tests can play a dropped connection', () => {
      const eventEmitter = new EventTarget()
      const mock = { offline: false, eventEmitter }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__JEAN_E2E_MOCK__ = mock
      const { result } = renderHook(() => useBackendOffline())
      expect(result.current).toBe(false)

      act(() => {
        mock.offline = true
        eventEmitter.dispatchEvent(new CustomEvent('e2e:connection'))
      })
      expect(result.current).toBe(true)
      expect(isBackendOffline()).toBe(true)

      act(() => {
        mock.offline = false
        eventEmitter.dispatchEvent(new CustomEvent('e2e:connection'))
      })
      expect(result.current).toBe(false)
    })
  })

  describe('the models (a local instance without a network)', () => {
    it('are reachable while this machine has a network', () => {
      transport.ws = false
      expect(renderHook(() => useModelsOffline()).result.current).toBe(false)
    })

    it('are offline when the local machine loses its network, and come back', () => {
      transport.ws = false
      const { result } = renderHook(() => useModelsOffline())

      setNavigatorOnline(false)
      expect(result.current).toBe(true)

      setNavigatorOnline(true)
      expect(result.current).toBe(false)
    })

    // A remote client's network says nothing about the host's.
    it('are not reported by a remote client', () => {
      transport.ws = true
      const { result } = renderHook(() => useModelsOffline())
      setNavigatorOnline(false)
      expect(result.current).toBe(false)
    })
  })
})
