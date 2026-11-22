import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import QRCode from 'qrcode'
import { connectionLink } from '@/lib/remote-connections'
import { WebAccessPane } from './WebAccessPane'
import { defaultPreferences } from '@/types/preferences'

const invokeMock = vi.fn()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => false,
  hasBackend: () => true,
}))

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
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
  })
})
