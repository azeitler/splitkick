import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteConnectionsDialog } from './RemoteConnectionsDialog'

const remoteInstall = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/lib/remote-install', () => ({
  get REMOTE_INSTALL_ENABLED() {
    return remoteInstall.enabled
  },
}))

const {
  addRemoteConnection,
  selectConnection,
  fetchRemoteServerInfo,
  getLocalJeanVersion,
  warnRemoteVersionMismatch,
  invoke,
  isNativeApp,
  listenLocal,
  listenMenu,
  removeRemoteConnection,
  connections,
  windowState,
} = vi.hoisted(() => ({
  listenMenu: vi.fn(async (_event: string, _handler: () => void) => () => {
    // no-op unsubscribe
  }),
  // The connection this window drives; `connectionWindow` marks a remote window.
  windowState: { activeId: 'local', connectionWindow: false },
  addRemoteConnection: vi.fn(
    async (): Promise<{ id: string }> => ({ id: 'remote-1' })
  ),
  removeRemoteConnection: vi.fn(async () => undefined),
  connections: {
    list: [] as { id: string; name: string; url: string; token: string }[],
  },
  selectConnection: vi.fn(),
  fetchRemoteServerInfo: vi.fn(async () => ({
    ok: true,
    appVersion: '0.1.69',
    webBuildId: '0.1.69-test',
  })),
  getLocalJeanVersion: vi.fn(() => '0.1.69'),
  warnRemoteVersionMismatch: vi.fn(() => false),
  invoke: vi.fn(),
  isNativeApp: vi.fn(() => false),
  listenLocal: vi.fn(async () => () => {
    // no-op unsubscribe
  }),
}))

vi.mock('@/lib/remote-connections', () => ({
  parseConnectionLink: (link: string) => {
    const parsed = new URL(link)
    if (parsed.host !== 'connect') return null
    return {
      name: parsed.searchParams.get('name') ?? '',
      url: parsed.searchParams.get('url') ?? '',
      token: parsed.searchParams.get('token') ?? '',
    }
  },
  withTokenFromUrl: (rawUrl: string, currentToken: string) => {
    let parsed: URL
    try {
      parsed = new URL(rawUrl.trim())
    } catch {
      return { url: rawUrl, token: currentToken }
    }
    const token = parsed.searchParams.get('token')?.trim()
    if (!token) return { url: rawUrl, token: currentToken }
    parsed.searchParams.delete('token')
    return { url: parsed.toString(), token }
  },
  getRemoteConnections: () => [],
  LOCAL_CONNECTION_ID: 'local',
  addRemoteConnection,
  getActiveConnectionId: () => windowState.activeId,
  isConnectionWindow: () => windowState.connectionWindow,
  removeRemoteConnection,
  markConnectionSwitch: vi.fn(),
  parseOptionalSshPort: (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    const port = Number(trimmed)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SSH port must be an integer between 1 and 65535.')
    }
    return port
  },
  parseRemoteConnectionInput: (url: string, token: string) => {
    const parsed = new URL(url)
    const resolvedToken =
      token.trim() || parsed.searchParams.get('token')?.trim() || ''
    parsed.search = ''
    return {
      url: parsed.toString().replace(/\/$/, ''),
      token: resolvedToken,
    }
  },
  selectConnection,
  updateRemoteConnection: vi.fn(),
  useRemoteConnections: () => connections.list,
}))

vi.mock('@/lib/remote-version', () => ({
  checkRemoteVersionCompatibility: (remote: string | null | undefined) => ({
    compatible: !remote || remote === '0.1.69',
    localVersion: '0.1.69',
    remoteVersion: remote ?? null,
    message: remote
      ? `This Jean app is v0.1.69, but the remote server is v${remote}.`
      : undefined,
  }),
  fetchRemoteServerInfo,
  formatJeanVersionLabel: (version: string | null | undefined) =>
    version ? `v${version.replace(/^v/, '')}` : 'version unknown',
  formatRemoteServerLabel: ({
    appVersion,
  }: {
    appVersion: string | null | undefined
  }) => (appVersion ? `v${appVersion.replace(/^v/, '')}` : 'version unknown'),
  getLocalJeanVersion,
  warnRemoteVersionMismatch,
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => isNativeApp(),
}))

vi.mock('@/lib/transport', () => ({
  invoke,
  listenLocal,
  listenMenu,
}))

describe('RemoteConnectionsDialog', () => {
  beforeEach(() => {
    remoteInstall.enabled = true
    vi.clearAllMocks()
    invoke.mockReset()
    fetchRemoteServerInfo.mockResolvedValue({
      ok: true,
      appVersion: '0.1.69',
      webBuildId: '0.1.69-test',
    })
    warnRemoteVersionMismatch.mockReturnValue(false)
    isNativeApp.mockReturnValue(false)
    connections.list = []
    windowState.activeId = 'local'
    windowState.connectionWindow = false
  })

  it('fills the token field from a pasted link with token=', () => {
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))

    fireEvent.change(screen.getByLabelText('Web Access URL'), {
      target: { value: 'https://jean.example.com/?token=secret' },
    })

    expect(screen.getByLabelText('Web Access URL')).toHaveValue(
      'https://jean.example.com/'
    )
    expect(screen.getByLabelText('Access token')).toHaveValue('secret')
  })

  it('fills in Add remote from a pending splitkick://connect link', async () => {
    isNativeApp.mockReturnValue(true)
    invoke.mockImplementation(async (command: string) =>
      command === 'take_pending_connection_link'
        ? 'splitkick://connect?url=http%3A%2F%2Fmac-2%3A3456&token=tok&name=mac-2'
        : []
    )
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)

    expect(await screen.findByLabelText('Web Access URL')).toHaveValue(
      'http://mac-2:3456'
    )
    expect(screen.getByLabelText('Access token')).toHaveValue('tok')
    expect(screen.getByLabelText('Name')).toHaveValue('mac-2')
    // Nothing is saved until the user clicks Save & Connect.
    expect(addRemoteConnection).not.toHaveBeenCalled()
  })

  describe('in a connection window', () => {
    beforeEach(() => {
      isNativeApp.mockReturnValue(true)
      invoke.mockResolvedValue([])
      windowState.activeId = 'remote-a'
      windowState.connectionWindow = true
      connections.list = [
        {
          id: 'remote-a',
          name: 'Build box',
          url: 'https://a.example.com',
          token: 't',
        },
        {
          id: 'remote-b',
          name: 'Other box',
          url: 'https://b.example.com',
          token: 't',
        },
      ]
    })

    it('shows only the server of this window', async () => {
      render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)
      fireEvent.click(
        screen.getByRole('button', { name: 'Server connections' })
      )

      expect(
        screen.getByText('This window is connected to Build box.')
      ).toBeInTheDocument()
      expect(screen.getByText('https://a.example.com')).toBeInTheDocument()
      expect(screen.queryByText('Local')).not.toBeInTheDocument()
      expect(screen.queryByText('Other box')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Add remote' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Delete Build box' })
      ).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Edit Build box' }))
      expect(screen.getByLabelText('Web Access URL')).toHaveValue(
        'https://a.example.com'
      )
    })

    it('hands list management to the main window', async () => {
      render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)
      fireEvent.click(
        screen.getByRole('button', { name: 'Server connections' })
      )
      fireEvent.click(
        screen.getByRole('button', { name: 'Manage all connections' })
      )

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('focus_main_window', {
          openConnections: true,
        })
      })
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Manage all connections' })
        ).not.toBeInTheDocument()
      })
      // A connection window does not listen for the main window's request.
      expect(listenMenu).not.toHaveBeenCalled()
    })
  })

  it('opens when a connection window asks the main window', async () => {
    isNativeApp.mockReturnValue(true)
    invoke.mockResolvedValue([])
    const handlers: Record<string, () => void> = {}
    listenMenu.mockImplementation(
      async (event: string, handler: () => void) => {
        handlers[event] = handler
        return () => undefined
      }
    )
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)

    await waitFor(() => {
      expect(listenMenu).toHaveBeenCalledWith(
        'connections:open',
        expect.any(Function)
      )
    })
    act(() => handlers['connections:open']?.())
    expect(
      await screen.findByRole('button', { name: 'Add remote' })
    ).toBeInTheDocument()
  })

  it('uses the title bar tooltip instead of the native browser tooltip', async () => {
    const user = userEvent.setup()
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'Server connections' })
    expect(trigger).not.toHaveAttribute('title')

    await user.hover(trigger)

    // Radix renders the tooltip twice: visible content and a11y announcement.
    const labels = await screen.findAllByText('Server connections', undefined, {
      timeout: 3000,
    })
    expect(labels.length).toBeGreaterThan(0)
  })

  // The rows gave no feedback at all: no hover, no press, no focus ring.
  it('gives a connection row hover, press and focus feedback', () => {
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))

    const select = screen.getByRole('button', { name: /^Local/ })
    const row = select.closest('[data-connection-row]')
    expect(row).not.toBeNull()
    expect(row?.className).toMatch(/has-\[\[data-row-select\]:hover\]:/)
    expect(row?.className).toMatch(/has-\[\[data-row-select\]:active\]:/)
    // Local is the connection this window drives.
    expect(row?.getAttribute('data-active')).toBe('true')
    expect(select.className).toMatch(/focus-visible:/)
    expect(select.className).toContain('cursor-pointer')
  })

  it('adds and selects a remote from a complete Web Access URL', async () => {
    const reloadApp = vi.fn()
    render(<RemoteConnectionsDialog reloadApp={reloadApp} />)

    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Build server' },
    })
    fireEvent.change(screen.getByLabelText('Web Access URL'), {
      target: { value: 'https://jean.example.com/?token=secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & Connect' }))

    await waitFor(() => {
      expect(fetchRemoteServerInfo).toHaveBeenCalledWith(
        'https://jean.example.com',
        'secret'
      )
      expect(addRemoteConnection).toHaveBeenCalledWith({
        name: 'Build server',
        url: 'https://jean.example.com/',
        token: 'secret',
        sshUser: undefined,
        sshHost: undefined,
        sshPort: 22,
      })
      expect(selectConnection).toHaveBeenCalledWith('remote-1')
      expect(reloadApp).toHaveBeenCalled()
    })
  })

  // The desktop shell saves to its backend and the Keychain (#94); a failed
  // save must show, not leave a connection that only exists in memory.
  it('shows a failed save and does not connect', async () => {
    addRemoteConnection.mockRejectedValueOnce(
      new Error('Keychain write failed: denied')
    )
    const reloadApp = vi.fn()
    render(<RemoteConnectionsDialog reloadApp={reloadApp} />)

    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))
    fireEvent.change(screen.getByLabelText('Web Access URL'), {
      target: { value: 'https://jean.example.com/?token=secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & Connect' }))

    expect(
      await screen.findByText('Keychain write failed: denied')
    ).toBeInTheDocument()
    expect(selectConnection).not.toHaveBeenCalled()
    expect(reloadApp).not.toHaveBeenCalled()
  })

  it('shows a failed delete', async () => {
    connections.list = [
      { id: 'remote-1', name: 'mac-2', url: 'http://mac-2:3460', token: 't' },
    ]
    removeRemoteConnection.mockRejectedValueOnce(
      new Error('Keychain delete failed')
    )
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete mac-2' }))

    expect(
      await screen.findByText('Keychain delete failed')
    ).toBeInTheDocument()
    expect(removeRemoteConnection).toHaveBeenCalledWith('remote-1')
  })

  it('shows local version and still connects when remote mismatches', async () => {
    fetchRemoteServerInfo.mockResolvedValueOnce({
      ok: true,
      appVersion: '0.2.0',
      webBuildId: '0.2.0-test',
    })
    warnRemoteVersionMismatch.mockReturnValueOnce(true)

    const reloadApp = vi.fn()
    render(<RemoteConnectionsDialog reloadApp={reloadApp} />)

    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    expect(screen.getByText('v0.1.69')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))
    fireEvent.change(screen.getByLabelText('Web Access URL'), {
      target: { value: 'https://jean.example.com/?token=secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & Connect' }))

    await waitFor(() => {
      expect(warnRemoteVersionMismatch).toHaveBeenCalledWith('0.2.0')
      expect(addRemoteConnection).toHaveBeenCalled()
      expect(selectConnection).toHaveBeenCalledWith('remote-1')
      expect(reloadApp).toHaveBeenCalled()
    })
  })

  it('saves optional SSH fields when adding a remote URL', async () => {
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Build server' },
    })
    fireEvent.change(screen.getByLabelText('Web Access URL'), {
      target: { value: 'https://jean.example.com/?token=secret' },
    })
    fireEvent.change(screen.getByLabelText('SSH user'), {
      target: { value: 'ubuntu' },
    })
    fireEvent.change(screen.getByLabelText('SSH host'), {
      target: { value: '192.168.1.50' },
    })
    fireEvent.change(screen.getByLabelText('SSH port'), {
      target: { value: '2222' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & Connect' }))

    await waitFor(() => {
      expect(addRemoteConnection).toHaveBeenCalledWith({
        name: 'Build server',
        url: 'https://jean.example.com/',
        token: 'secret',
        sshUser: 'ubuntu',
        sshHost: '192.168.1.50',
        sshPort: 2222,
      })
    })
  })

  it('installs splitkick-server via SSH user and host in the native app', async () => {
    isNativeApp.mockReturnValue(true)
    invoke.mockResolvedValue({
      name: 'build-box',
      url: 'http://192.168.1.50:3460',
      token: 'tok-abc',
      alreadyInstalled: false,
      installMode: 'system',
      ready: true,
      log: 'ok',
    })
    const reloadApp = vi.fn()

    render(<RemoteConnectionsDialog reloadApp={reloadApp} />)

    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))

    expect(
      screen.getByRole('tab', { name: /Install via SSH/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: /Existing URL/i })
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'build-box' },
    })
    fireEvent.change(screen.getByLabelText('SSH user'), {
      target: { value: 'ubuntu' },
    })
    fireEvent.change(screen.getByLabelText('Host / IP'), {
      target: { value: '192.168.1.50' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Install & Connect/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('install_remote_jean_server', {
        name: 'build-box',
        user: 'ubuntu',
        host: '192.168.1.50',
        sshPort: 22,
        jeanPort: 3460,
        userInstall: null,
      })
    })

    await waitFor(() => {
      expect(addRemoteConnection).toHaveBeenCalledWith({
        name: 'build-box',
        url: 'http://192.168.1.50:3460',
        token: 'tok-abc',
        sshUser: 'ubuntu',
        sshHost: '192.168.1.50',
        sshPort: 22,
      })
    })

    // The native shell gives the new remote its own window instead of
    // reloading this one.
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('open_connection_window', {
        connectionId: 'remote-1',
        title: null,
      })
    })
    expect(selectConnection).not.toHaveBeenCalled()
    expect(reloadApp).not.toHaveBeenCalled()

    // The dialog gets out of the way once the window is on its way.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('can switch from install mode to existing URL mode', async () => {
    isNativeApp.mockReturnValue(true)
    invoke.mockResolvedValue([])
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    // Opening the dialog asks which connections already have a window.
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('list_connection_windows')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))
    fireEvent.click(screen.getByRole('tab', { name: /Existing URL/i }))

    expect(screen.getByLabelText('Web Access URL')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save & Connect' })
    ).toBeInTheDocument()
  })

  it('offers only an existing URL while remote install is off', async () => {
    remoteInstall.enabled = false
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Server connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))
    expect(screen.queryByText('Install via SSH')).toBeNull()
    expect(screen.queryByText('Install & Connect')).toBeNull()
  })

  it('opens the edit form without its button (connection recovery screen)', async () => {
    connections.list = [
      { id: 'remote-1', name: 'Lab', url: 'https://lab.example', token: 'tok' },
    ]
    render(<RemoteConnectionsDialog reloadApp={vi.fn()} showTrigger={false} />)
    expect(
      screen.queryByRole('button', { name: 'Server connections' })
    ).toBeNull()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('open-remote-connections', {
          detail: { id: 'remote-1' },
        })
      )
    })

    expect(await screen.findByDisplayValue('Lab')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://lab.example')).toBeInTheDocument()
  })
})
