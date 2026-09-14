import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  invoke,
  isNativeApp,
  getRemoteConnections,
  markConnectionSwitch,
  selectConnection,
} = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  isNativeApp: vi.fn(() => true),
  getRemoteConnections: vi.fn(() => [] as { id: string; name: string }[]),
  markConnectionSwitch: vi.fn(),
  selectConnection: vi.fn(),
}))

vi.mock('./transport', () => ({ invoke }))
vi.mock('./environment', () => ({ isNativeApp: () => isNativeApp() }))
vi.mock('./remote-connections', () => ({
  LOCAL_CONNECTION_ID: 'local',
  getRemoteConnections: () => getRemoteConnections(),
  markConnectionSwitch,
  selectConnection,
}))

import {
  activateConnection,
  closeConnectionWindow,
  listConnectionWindows,
  openConnectionWindow,
} from './connection-windows'

describe('activateConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativeApp.mockReturnValue(true)
  })

  it('gives a remote its own window on the desktop', async () => {
    getRemoteConnections.mockReturnValue([
      { id: 'remote-1', name: 'build-box' },
    ])
    const reloadApp = vi.fn()

    await activateConnection('remote-1', reloadApp)

    expect(invoke).toHaveBeenCalledWith('open_connection_window', {
      connectionId: 'remote-1',
      title: 'build-box',
    })
    expect(reloadApp).not.toHaveBeenCalled()
    expect(selectConnection).not.toHaveBeenCalled()
  })

  it('focuses the main window for the local backend', async () => {
    const reloadApp = vi.fn()

    await activateConnection('local', reloadApp)

    expect(invoke).toHaveBeenCalledWith('focus_main_window')
    expect(reloadApp).not.toHaveBeenCalled()
  })

  it('swaps in place in Web Access, which has only one browsing context', async () => {
    isNativeApp.mockReturnValue(false)
    const reloadApp = vi.fn()

    await activateConnection('remote-1', reloadApp)

    expect(markConnectionSwitch).toHaveBeenCalledOnce()
    expect(selectConnection).toHaveBeenCalledWith('remote-1')
    expect(reloadApp).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('openConnectionWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativeApp.mockReturnValue(true)
  })

  it('names the window after its connection', async () => {
    // The window carries this name in the macOS Window menu until MainWindow
    // mounts, which waits for the remote to answer.
    getRemoteConnections.mockReturnValue([
      { id: 'remote-1', name: 'build-box' },
    ])

    await openConnectionWindow('remote-1')

    expect(invoke).toHaveBeenCalledWith('open_connection_window', {
      connectionId: 'remote-1',
      title: 'build-box',
    })
  })

  it('leaves the name to the backend when the connection is unknown', async () => {
    await openConnectionWindow('remote-9')

    expect(invoke).toHaveBeenCalledWith('open_connection_window', {
      connectionId: 'remote-9',
      title: null,
    })
  })
})

describe('listConnectionWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativeApp.mockReturnValue(true)
  })

  it('reports nothing in Web Access, where there are no windows', async () => {
    isNativeApp.mockReturnValue(false)

    await expect(listConnectionWindows()).resolves.toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('survives a backend that answers with something other than a list', async () => {
    invoke.mockResolvedValueOnce(null as never)

    await expect(listConnectionWindows()).resolves.toEqual([])
  })
})

describe('closeConnectionWindow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names the connection whose window must go', async () => {
    await closeConnectionWindow('remote-1')

    expect(invoke).toHaveBeenCalledWith('close_connection_window', {
      connectionId: 'remote-1',
    })
  })
})
