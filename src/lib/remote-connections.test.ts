import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addRemoteConnection,
  clearConnectionSwitch,
  getActiveConnectionId,
  getActiveRemoteConnection,
  getRemoteConnections,
  isConnectionSwitchPending,
  markConnectionSwitch,
  parseRemoteConnectionInput,
  removeRemoteConnection,
  selectConnection,
  updateRemoteConnection,
  useActiveRemoteConnection,
} from './remote-connections'

describe('remote connections', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('extracts a token from a complete Web Access URL', () => {
    expect(
      parseRemoteConnectionInput('https://jean.example.com/?token=secret', '')
    ).toEqual({ url: 'https://jean.example.com', token: 'secret' })
  })

  it('accepts a separate token and normalizes the URL', () => {
    expect(
      parseRemoteConnectionInput('http://server.local:3456///', ' token ')
    ).toEqual({ url: 'http://server.local:3456', token: 'token' })
  })

  it('rejects unsupported URL schemes', () => {
    expect(() => parseRemoteConnectionInput('ftp://server', 'token')).toThrow(
      'HTTP or HTTPS'
    )
  })

  it('persists CRUD operations and the active selection', () => {
    const remote = addRemoteConnection({
      name: 'Build server',
      url: 'https://jean.example.com?token=first',
      token: '',
    })

    expect(getRemoteConnections()).toEqual([remote])

    selectConnection(remote.id)
    expect(getActiveConnectionId()).toBe(remote.id)
    expect(getActiveRemoteConnection()).toEqual(remote)

    const updated = updateRemoteConnection(remote.id, {
      name: 'Production',
      url: remote.url,
      token: 'second',
    })
    expect(getRemoteConnections()).toEqual([updated])

    removeRemoteConnection(remote.id)
    expect(getRemoteConnections()).toEqual([])
    expect(getActiveConnectionId()).toBe('local')
  })

  it('marks an intentional switch so unload cleanup can be skipped', () => {
    markConnectionSwitch()
    expect(isConnectionSwitchPending()).toBe(true)

    clearConnectionSwitch()
    expect(isConnectionSwitchPending()).toBe(false)
  })

  it('persists optional SSH fields for remote editor open', () => {
    const remote = addRemoteConnection({
      name: 'Build server',
      url: 'https://jean.example.com?token=first',
      token: '',
      sshUser: 'ubuntu',
      sshHost: '192.168.1.50',
      sshPort: 2222,
    })

    expect(remote).toMatchObject({
      sshUser: 'ubuntu',
      sshHost: '192.168.1.50',
      sshPort: 2222,
    })
    expect(getRemoteConnections()[0]).toMatchObject({
      sshUser: 'ubuntu',
      sshHost: '192.168.1.50',
      sshPort: 2222,
    })

    const updated = updateRemoteConnection(remote.id, {
      name: remote.name,
      url: remote.url,
      token: 'second',
      sshUser: 'deploy',
      sshHost: '192.168.1.50',
      sshPort: 22,
    })
    expect(updated.sshUser).toBe('deploy')
    // Default SSH port is not stored.
    expect(updated.sshPort).toBeUndefined()
  })

  it('tracks the active remote connection reactively', () => {
    const remote = addRemoteConnection({
      name: 'Build server',
      url: 'https://jean.example.com',
      token: 'secret',
    })

    const { result } = renderHook(() => useActiveRemoteConnection())
    expect(result.current).toBeNull()

    act(() => selectConnection(remote.id))
    expect(result.current).toEqual(remote)

    act(() => removeRemoteConnection(remote.id))
    expect(result.current).toBeNull()
  })
})

/**
 * The module reads the URL and the window label while it loads, so every case
 * needs a fresh import against a prepared `window`.
 */
describe('connection windows', () => {
  interface Internals {
    invoke?: () => void
    metadata?: { currentWindow?: { label?: string } }
  }

  // The shared test setup stubs localStorage with a getter that always
  // returns null. These cases turn on real storage behaviour.
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.mocked(localStorage.getItem).mockImplementation(
      key => store.get(key) ?? null
    )
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      store.set(key, value)
    })
    vi.mocked(localStorage.removeItem).mockImplementation(key => {
      store.delete(key)
    })
  })

  async function importPinned({
    search = '',
    label,
    native = true,
    saved,
    connections,
  }: {
    search?: string
    label?: string
    native?: boolean
    saved?: string
    connections?: { id: string; name: string; url: string; token: string }[]
  }) {
    vi.resetModules()
    store.clear()
    window.history.replaceState({}, '', `/${search}`)
    if (connections) {
      store.set('jean-remote-connections', JSON.stringify(connections))
    }
    if (saved) store.set('jean-active-connection', saved)

    const internals: Internals | undefined = native
      ? {
          invoke: () => undefined,
          metadata: { currentWindow: { label: label ?? 'main' } },
        }
      : undefined
    ;(
      window as unknown as { __TAURI_INTERNALS__?: Internals }
    ).__TAURI_INTERNALS__ = internals

    return import('./remote-connections')
  }

  const REMOTE = {
    id: 'remote-1',
    name: 'Build server',
    url: 'https://build.example.com',
    token: 'build-token',
  }

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: Internals })
      .__TAURI_INTERNALS__
    window.history.replaceState({}, '', '/')
    vi.mocked(localStorage.getItem).mockReturnValue(null)
    vi.mocked(localStorage.setItem).mockReset()
    vi.mocked(localStorage.removeItem).mockReset()
  })

  it('pins the window to the connection in the URL', async () => {
    const mod = await importPinned({
      search: '?connection=remote-1',
      label: 'remote-remote-1',
      connections: [REMOTE],
    })

    expect(mod.isConnectionWindow()).toBe(true)
    expect(mod.getActiveConnectionId()).toBe('remote-1')
    expect(mod.getActiveRemoteConnection()?.url).toBe(REMOTE.url)
  })

  it('falls back to the window label when the query string is gone', async () => {
    const mod = await importPinned({
      label: 'remote-remote-1',
      connections: [REMOTE],
    })

    expect(mod.isConnectionWindow()).toBe(true)
    expect(mod.getActiveConnectionId()).toBe('remote-1')
  })

  it('keeps the pin when the connection was deleted', async () => {
    // Falling back to local here would let a remote window drive this machine.
    // App.tsx closes the window instead.
    const mod = await importPinned({ search: '?connection=remote-1' })

    expect(mod.isConnectionWindow()).toBe(true)
    expect(mod.getActiveConnectionId()).toBe('remote-1')
    expect(mod.getActiveRemoteConnection()).toBeNull()
  })

  it('never lets a connection window rewrite the shared active id', async () => {
    const mod = await importPinned({
      search: '?connection=remote-1',
      connections: [REMOTE],
    })

    mod.selectConnection('local')

    expect(mod.getActiveConnectionId()).toBe('remote-1')
    expect(localStorage.getItem('jean-active-connection')).toBeNull()
  })

  it('keeps the desktop main window on the local backend', async () => {
    const mod = await importPinned({ saved: 'remote-1', connections: [REMOTE] })

    expect(mod.isConnectionWindow()).toBe(false)
    expect(mod.getActiveConnectionId()).toBe('local')
  })

  it('still swaps the connection in place in Web Access', async () => {
    const mod = await importPinned({
      native: false,
      saved: 'remote-1',
      connections: [REMOTE],
    })

    expect(mod.isConnectionWindow()).toBe(false)
    expect(mod.getActiveConnectionId()).toBe('remote-1')
  })

  it('hands back the previously active remote once, then forgets it', async () => {
    const mod = await importPinned({ saved: 'remote-1', connections: [REMOTE] })

    expect(mod.takeMigratedRemoteConnectionId()).toBe('remote-1')
    expect(mod.takeMigratedRemoteConnectionId()).toBeNull()
    expect(localStorage.getItem('jean-active-connection')).toBeNull()
  })

  it('has nothing to migrate in a connection window', async () => {
    const mod = await importPinned({
      search: '?connection=remote-1',
      saved: 'remote-1',
      connections: [REMOTE],
    })

    expect(mod.takeMigratedRemoteConnectionId()).toBeNull()
    // The main window still needs to read it.
    expect(localStorage.getItem('jean-active-connection')).toBe('remote-1')
  })
})
