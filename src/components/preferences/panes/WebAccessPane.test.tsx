import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDialog,
  confirmDialog,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import QRCode from 'qrcode'
import { connectionLink } from '@/lib/remote-connections'
import { WebAccessPane, onePasswordItemUrls } from './WebAccessPane'
import { defaultPreferences } from '@/types/preferences'

const invokeMock = vi.fn()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const localBackend = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/environment', () => ({
  isNativeApp: () => false,
  hasBackend: () => true,
  hasBackendTransport: () => true,
  isLocalBackend: () => localBackend.value,
}))

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'toast') },
}))
vi.mock('qrcode', async importOriginal => {
  const actual = await importOriginal<{ default: typeof QRCode }>()
  return {
    default: { ...actual.default, toString: vi.fn(actual.default.toString) },
  }
})
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn() }))
vi.mock('@/lib/platform', () => ({
  isMacOS: false,
  isWindows: false,
  isLinux: true,
  isClientMacOS: () => false,
  getServerPlatform: vi.fn(() => 'linux'),
  isServerWindows: vi.fn(() => false),
  openExternal: vi.fn(),
}))

describe('WebAccessPane in browser/headless mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'load_preferences')
        return Promise.resolve(defaultPreferences)
      if (command === 'get_http_server_status') {
        return Promise.resolve({
          running: true,
          port: 3456,
          url: 'http://0.0.0.0:3456',
          token: 'secret-token',
          bind_host: '0.0.0.0',
          localhost_only: false,
        })
      }
      if (command === 'list_http_bind_host_options') return Promise.resolve([])
      return Promise.resolve(null)
    })
  })

  it('shows web access controls in browser mode so headless users can configure it', async () => {
    render(<WebAccessPane />)

    await waitFor(() => {
      expect(screen.getByText('Enable HTTP server')).toBeInTheDocument()
    })
    expect(
      screen.queryByText(/only available in the desktop app/i)
    ).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('secret-token')).toBeInTheDocument()
  })

  it('shows only this device on a phone, not the server switches (#72)', () => {
    mobile.value = true
    render(<WebAccessPane />)
    expect(screen.getByText('This device')).toBeInTheDocument()
    expect(screen.getByText('Reset app cache')).toBeInTheDocument()
    expect(screen.queryByText('Enable HTTP server')).not.toBeInTheDocument()
    mobile.value = false
  })

  it('opens a QR code of the connection link from the button (#150)', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'load_preferences')
        return Promise.resolve(defaultPreferences)
      if (command === 'get_http_server_status') {
        return Promise.resolve({
          running: true,
          port: 3456,
          url: 'http://studio.example.ts.net:3456',
          token: 'secret-token',
          bind_host: '100.64.0.1',
          localhost_only: false,
        })
      }
      if (command === 'list_http_bind_host_options') return Promise.resolve([])
      return Promise.resolve(null)
    })
    render(<WebAccessPane />)

    const button = await screen.findByRole('button', {
      name: 'Show connection QR code',
    })
    expect(screen.queryByTestId('connection-qr-code')).not.toBeInTheDocument()

    await userEvent.click(button)

    expect(await screen.findByTestId('connection-qr-code')).toBeInTheDocument()
    expect(vi.mocked(QRCode.toString)).toHaveBeenCalledWith(
      connectionLink('http://studio.example.ts.net:3456', 'secret-token'),
      expect.objectContaining({ type: 'svg' })
    )
    expect(
      screen.getByText(/Anyone who scans this code can use this/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/iOS blocks plain HTTP to host names/)
    ).toBeInTheDocument()
  })
})

describe('WebAccessPane Tailscale block (#151)', () => {
  const baseInfo = {
    installed: true,
    running: true,
    tailnetName: 'tail1234.ts.net',
    magicDnsEnabled: true,
    dnsName: 'box.tail1234.ts.net',
    ips: ['100.64.0.1'],
    serves: [] as unknown[],
    port: 3456,
  }

  function mockTailscale(info: unknown) {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'load_preferences')
        return Promise.resolve(defaultPreferences)
      if (command === 'get_http_server_status') {
        return Promise.resolve({
          running: true,
          port: 3456,
          url: 'http://127.0.0.1:3456',
          token: 'secret-token',
          bind_host: '127.0.0.1',
          localhost_only: true,
        })
      }
      if (command === 'list_http_bind_host_options') return Promise.resolve([])
      if (command === 'get_tailscale_info') return Promise.resolve(info)
      return Promise.resolve(null)
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mobile.value = false
  })

  it('hides the block when Tailscale is not installed', async () => {
    mockTailscale({ ...baseInfo, installed: false, running: false })
    render(<WebAccessPane />)
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('get_tailscale_info')
    )
    expect(screen.queryByText('Tailscale')).not.toBeInTheDocument()
  })

  it('says when Tailscale is installed but not connected', async () => {
    mockTailscale({ ...baseInfo, running: false, dnsName: null })
    render(<WebAccessPane />)
    expect(
      await screen.findByText('Tailscale is installed but not connected.')
    ).toBeInTheDocument()
  })

  it('shows the MagicDNS name and a serve hint when not served', async () => {
    mockTailscale(baseInfo)
    render(<WebAccessPane />)
    expect(
      await screen.findByDisplayValue('box.tail1234.ts.net')
    ).toBeInTheDocument()
    expect(screen.getByText('Tailnet tail1234.ts.net')).toBeInTheDocument()
    expect(screen.getByText('tailscale serve --bg 3456')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy serve command')).toBeInTheDocument()
    expect(
      screen.queryByDisplayValue('https://box.tail1234.ts.net')
    ).not.toBeInTheDocument()
  })

  it('notes when MagicDNS is off', async () => {
    mockTailscale({ ...baseInfo, magicDnsEnabled: false })
    render(<WebAccessPane />)
    expect(
      await screen.findByText(/MagicDNS is off in this tailnet/)
    ).toHaveTextContent('100.64.0.1')
  })

  it('lists the served https URL and the serve status', async () => {
    mockTailscale({
      ...baseInfo,
      serves: [
        {
          url: 'https://box.tail1234.ts.net',
          proxyTarget: 'http://localhost:3456',
          servesSplitkick: true,
          funnel: false,
        },
      ],
    })
    render(<WebAccessPane />)
    expect(
      await screen.findByDisplayValue('https://box.tail1234.ts.net')
    ).toBeInTheDocument()
    expect(screen.getByText(/Served via tailscale serve/)).toBeInTheDocument()
    expect(screen.queryByText(/tailscale serve --bg/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Public on the internet/)).not.toBeInTheDocument()
    // Labelled, with a hint, and listed after the other access URLs.
    expect(
      screen.getByText(
        'HTTPS through tailscale serve, for devices in your tailnet'
      )
    ).toBeInTheDocument()
    const urls = screen
      .getAllByRole('textbox')
      .map(input => (input as HTMLInputElement).value)
      .filter(value => /^https?:\/\//.test(value))
    expect(urls.at(-1)).toBe('https://box.tail1234.ts.net')
    expect(urls.length).toBeGreaterThan(1)
  })

  it('ignores a serve entry for another port', async () => {
    mockTailscale({
      ...baseInfo,
      serves: [
        {
          url: 'https://box.tail1234.ts.net:8443',
          proxyTarget: 'http://127.0.0.1:5173',
          servesSplitkick: false,
          funnel: true,
        },
      ],
    })
    render(<WebAccessPane />)
    expect(
      await screen.findByText('tailscale serve --bg 3456')
    ).toBeInTheDocument()
    expect(
      screen.queryByDisplayValue('https://box.tail1234.ts.net:8443')
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Public on the internet/)).not.toBeInTheDocument()
  })

  it('warns when Funnel makes the server public', async () => {
    mockTailscale({
      ...baseInfo,
      serves: [
        {
          url: 'https://box.tail1234.ts.net',
          proxyTarget: 'http://localhost:3456',
          servesSplitkick: true,
          funnel: true,
        },
      ],
    })
    render(<WebAccessPane />)
    expect(
      await screen.findByText(/Public on the internet/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'HTTPS through Tailscale Funnel, open to the whole internet'
      )
    ).toBeInTheDocument()
  })
})

describe('WebAccessPane Instance Name and 1Password', () => {
  const status = {
    running: true,
    port: 3456,
    url: 'http://192.168.1.20:3456',
    token: 'secret-token',
    bind_host: '192.168.1.20',
    localhost_only: false,
  }

  function mockBackend(options: {
    name?: string | null
    opInstalled?: boolean
  }) {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'load_preferences')
        return Promise.resolve({
          ...defaultPreferences,
          session_backup_device_name: options.name ?? null,
        })
      if (command === 'get_http_server_status') return Promise.resolve(status)
      if (command === 'list_http_bind_host_options') return Promise.resolve([])
      if (command === 'get_default_device_name')
        return Promise.resolve('Computer Name')
      if (command === 'get_onepassword_status')
        return Promise.resolve({ installed: options.opInstalled ?? false })
      if (command === 'save_web_access_to_onepassword')
        return Promise.resolve({ title: 'Splitkick – Mac 1', updated: false })
      return Promise.resolve(null)
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mobile.value = false
    localBackend.value = false
  })

  it('shows the computer name as placeholder when no name is set', async () => {
    mockBackend({})
    render(<WebAccessPane />)
    const input = await screen.findByRole('textbox', { name: 'Instance Name' })
    await waitFor(() =>
      expect(input).toHaveAttribute('placeholder', 'Computer Name')
    )
    expect(input).toHaveValue('')
  })

  it('puts the Instance Name into the connection link', async () => {
    mockBackend({ name: 'Mac 1' })
    render(<WebAccessPane />)
    const input = await screen.findByRole('textbox', { name: 'Instance Name' })
    await waitFor(() => expect(input).toHaveValue('Mac 1'))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Show connection QR code' })
    )
    await waitFor(() =>
      expect(vi.mocked(QRCode.toString)).toHaveBeenCalledWith(
        connectionLink('http://192.168.1.20:3456', 'secret-token', 'Mac 1'),
        expect.objectContaining({ type: 'svg' })
      )
    )
  })

  it('saves URLs to 1Password from the local desktop app, without the token', async () => {
    localBackend.value = true
    mockBackend({ name: 'Mac 1', opInstalled: true })
    render(<WebAccessPane />)
    await userEvent.click(
      await screen.findByRole('button', { name: /Add to 1Password/ })
    )
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'save_web_access_to_onepassword',
        { urls: [{ label: 'Web Access', href: 'http://192.168.1.20:3456' }] }
      )
    )
    const call = invokeMock.mock.calls.find(
      ([command]) => command === 'save_web_access_to_onepassword'
    )
    expect(JSON.stringify(call)).not.toContain('secret-token')
  })

  it('hides the 1Password button when op is not installed', async () => {
    localBackend.value = true
    mockBackend({ opInstalled: false })
    render(<WebAccessPane />)
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('get_onepassword_status')
    )
    expect(
      screen.queryByRole('button', { name: /Add to 1Password/ })
    ).not.toBeInTheDocument()
  })

  it('never offers 1Password in Web Access or for a remote connection', async () => {
    mockBackend({ opInstalled: true })
    render(<WebAccessPane />)
    await screen.findByText('Enable HTTP server')
    expect(invokeMock).not.toHaveBeenCalledWith('get_onepassword_status')
    expect(
      screen.queryByRole('button', { name: /Add to 1Password/ })
    ).not.toBeInTheDocument()
  })

  it('lists the bound URL and the Tailscale URL', () => {
    expect(
      onePasswordItemUrls('http://192.168.1.20:3456', 'https://box.ts.net')
    ).toEqual([
      { label: 'Web Access', href: 'http://192.168.1.20:3456' },
      { label: 'Tailscale', href: 'https://box.ts.net' },
    ])
    expect(onePasswordItemUrls(null, null)).toEqual([])
  })
})

describe('WebAccessPane regenerate token confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mobile.value = false
    localBackend.value = false
    invokeMock.mockImplementation((command: string) => {
      if (command === 'load_preferences')
        return Promise.resolve(defaultPreferences)
      if (command === 'get_http_server_status') {
        return Promise.resolve({
          running: true,
          port: 3456,
          url: 'http://0.0.0.0:3456',
          token: 'secret-token',
          bind_host: '0.0.0.0',
          localhost_only: false,
        })
      }
      if (command === 'list_http_bind_host_options') return Promise.resolve([])
      if (command === 'regenerate_http_token')
        return Promise.resolve('new-token')
      return Promise.resolve(null)
    })
  })

  async function clickRegenerate() {
    render(<WebAccessPane />)
    await screen.findByDisplayValue('secret-token')
    const icon = document.querySelector('svg.lucide-refresh-cw')
    const button = icon?.closest('button')
    expect(button).toBeTruthy()
    await userEvent.click(button as HTMLButtonElement)
    expect(
      await screen.findByText('Regenerate the Web Access token?')
    ).toBeInTheDocument()
  }

  it('does not regenerate the token when the dialog is cancelled', async () => {
    await clickRegenerate()
    await cancelDialog()
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(invokeMock).not.toHaveBeenCalledWith('regenerate_http_token')
  })

  it('regenerates the token after confirming', async () => {
    await clickRegenerate()
    await confirmDialog()
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('regenerate_http_token')
    )
  })
})
