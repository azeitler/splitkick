import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canOpenInEditor,
  canOpenNativeApps,
  canOpenRemoteEditorLocally,
  canPickLocalPaths,
  hasBackend,
  hasBackendTransport,
  isBackendOnThisMachine,
  isLocalBackend,
  isNativeApp,
  isNativeOpenAllowed,
  setNativeOpenAllowed,
  setWebAccessEnabled,
  setWsConnected,
} from './environment'
import {
  addRemoteConnection,
  LOCAL_CONNECTION_ID,
  selectConnection,
} from './remote-connections'

const clearInternals = () => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__
}

describe('environment detection', () => {
  afterEach(() => {
    clearInternals()
    setWsConnected(false)
    setWebAccessEnabled(false)
    setNativeOpenAllowed(false)
    selectConnection(LOCAL_CONNECTION_ID)
  })

  it('does not treat partial Tauri internals as native', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })

    expect(isNativeApp()).toBe(false)
    expect(hasBackend()).toBe(false)
  })

  it('treats Tauri internals with invoke as native', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: vi.fn() },
    })

    expect(isNativeApp()).toBe(true)
    expect(isLocalBackend()).toBe(true)
    expect(hasBackend()).toBe(true)
  })

  it('treats a native shell on a remote connection as non-local backend', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: vi.fn() },
    })
    const remote = addRemoteConnection({
      name: 'Remote host',
      url: 'https://remote.example.com',
      token: 'test-token',
    })
    selectConnection(remote.id)

    expect(isNativeApp()).toBe(true)
    expect(isLocalBackend()).toBe(false)
    expect(hasBackendTransport()).toBe(true)
    expect(canOpenNativeApps()).toBe(false)
    expect(canOpenRemoteEditorLocally()).toBe(true)
    expect(canOpenInEditor()).toBe(true)
  })

  it('local desktop: every native capability is available', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: vi.fn() },
    })

    expect(isBackendOnThisMachine()).toBe(true)
    expect(canOpenNativeApps()).toBe(true)
    expect(canOpenInEditor()).toBe(true)
    expect(canOpenRemoteEditorLocally()).toBe(false)
    expect(canPickLocalPaths()).toBe(true)
  })

  it('Web Access on localhost: host-native open counts (user sits at the host)', () => {
    // jsdom serves the page from http://localhost
    setNativeOpenAllowed(true)
    expect(isBackendOnThisMachine()).toBe(true)
    expect(isNativeOpenAllowed()).toBe(true)
    expect(canOpenNativeApps()).toBe(true)
    expect(canOpenInEditor()).toBe(true)
    expect(canPickLocalPaths()).toBe(false)
  })

  it('Web Access on localhost without host permission: nothing opens', () => {
    expect(canOpenNativeApps()).toBe(false)
    expect(canOpenInEditor()).toBe(false)
  })

  it('native + remote host that allows open: still hidden, Zed path stays', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: vi.fn() },
    })
    const remote = addRemoteConnection({
      name: 'Studio Mac',
      url: 'https://studio.example.com',
      token: 'test-token',
    })
    selectConnection(remote.id)
    // The desktop app hosting Web Access always reports true
    setNativeOpenAllowed(true)

    expect(isBackendOnThisMachine()).toBe(false)
    expect(isNativeOpenAllowed()).toBe(false)
    expect(canOpenNativeApps()).toBe(false)
    expect(canOpenRemoteEditorLocally()).toBe(true)
    expect(canOpenInEditor()).toBe(true)
    expect(canPickLocalPaths()).toBe(false)
  })

  it('prefers host-native open over local ssh:// remap when remote allows it', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: vi.fn() },
    })
    const remote = addRemoteConnection({
      name: 'WSL Jean',
      url: 'http://127.0.0.1:3456',
      token: 'test-token',
    })
    selectConnection(remote.id)
    setNativeOpenAllowed(true)

    expect(isLocalBackend()).toBe(false)
    expect(canOpenNativeApps()).toBe(true)
    // ssh:// local remap is disabled when the backend can open apps itself
    expect(canOpenRemoteEditorLocally()).toBe(false)
    expect(canOpenInEditor()).toBe(true)
  })

  it('treats WebSocket connection as browser backend', () => {
    setWsConnected(true)

    expect(isNativeApp()).toBe(false)
    expect(isLocalBackend()).toBe(false)
    expect(hasBackend()).toBe(true)
  })

  it('keeps the web transport queryable while its socket connects', () => {
    setWebAccessEnabled(true)
    setWsConnected(false)

    expect(hasBackend()).toBe(false)
    expect(hasBackendTransport()).toBe(true)
  })
})
