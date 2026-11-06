import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserForAgentsSection,
  type BrowserEngineStatus,
} from './BrowserForAgentsSection'
import { invoke } from '@/lib/transport'

const mocks = vi.hoisted(() => ({ local: true }))

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => vi.fn()),
}))
vi.mock('@/lib/environment', () => ({
  isLocalBackend: () => mocks.local,
  isNativeApp: () => mocks.local,
}))
vi.mock('@/lib/platform', () => ({
  openExternal: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn() },
}))
vi.mock('@/hooks/useInstalledBackends', () => ({
  useInstalledBackends: () => ({
    installedBackends: ['claude', 'codex'],
    isLoading: false,
  }),
}))
vi.mock('@/services/mcp', () => ({ invalidateAllMcpServers: vi.fn() }))

const FAKE_TOKEN = 'fake-token-104-do-not-use'

function status(overrides: Partial<BrowserEngineStatus> = {}) {
  return {
    engine: 'agent_browser',
    hasToken: false,
    managedInstall: false,
    managedVersion: null,
    nodePath: '/opt/node/bin/node',
    extensionUrl: 'https://chromewebstore.google.com/detail/x',
    installedBackends: [],
    handMade: [],
    ...overrides,
  } as BrowserEngineStatus
}

let current: BrowserEngineStatus

function mockBackend() {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (command) {
      case 'get_browser_engine_status':
        return current
      case 'get_agent_browser_status':
        return {
          installed: false,
          binaryPath: null,
          version: null,
          profilePath: '/data/agent-browser/profile',
          profileExists: false,
          managedDir: '/data/agent-browser-cli',
          managedInstall: false,
          claudeSnippet: '{}',
          codexSnippet: '',
          installHint: 'npm install -g agent-browser',
        }
      case 'set_browser_engine': {
        const { engine } = args as { engine: BrowserEngineStatus['engine'] }
        current = { ...current, engine }
        return [
          {
            backend: 'claude',
            status: 'installed',
            message: '',
            conflicts: [],
          },
        ]
      }
      case 'save_browser_extension_token':
        current = { ...current, hasToken: true }
        return true
      case 'test_browser_connection':
        return '### Open tabs'
      default:
        return null
    }
  })
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserForAgentsSection />
    </QueryClientProvider>
  )
}

describe('BrowserForAgentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.local = true
    current = status()
    mockBackend()
  })

  it('offers off and the three engines', async () => {
    renderSection()
    for (const name of [
      'Off',
      'Agent Browser',
      'Playwright',
      'Playwright with your Chrome',
    ]) {
      expect(await screen.findByRole('radio', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('radio', { name: 'Agent Browser' })).toBeChecked()
  })

  it('writes the own-browser engine to the installed backends', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('radio', { name: 'Playwright' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_browser_engine', {
        engine: 'playwright',
        backends: ['claude', 'codex'],
        takeOver: false,
      })
    )
    expect(await screen.findByText('Test connection')).toBeInTheDocument()
    expect(screen.queryByTestId('browser-engine-warning')).toBeNull()
  })

  it('asks before using the real Chrome and then shows the warning', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(
      await screen.findByRole('radio', { name: 'Playwright with your Chrome' })
    )
    expect(
      await screen.findByText('Let agents use your Chrome?')
    ).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalledWith(
      'set_browser_engine',
      expect.anything()
    )
    await user.click(screen.getByRole('button', { name: 'Use my Chrome' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_browser_engine', {
        engine: 'playwright_extension',
        backends: ['claude', 'codex'],
        takeOver: false,
      })
    )
    expect(
      await screen.findByTestId('browser-engine-warning')
    ).toHaveTextContent('logged-in Chrome')
  })

  it('saves the token and never shows it back', async () => {
    current = status({ engine: 'playwright_extension' })
    const user = userEvent.setup()
    renderSection()
    const field = await screen.findByLabelText('Connection token')
    expect(field).toHaveAttribute('type', 'password')
    await user.type(field, FAKE_TOKEN)
    await user.click(screen.getByRole('button', { name: 'Save token' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('save_browser_extension_token', {
        token: FAKE_TOKEN,
      })
    )
    await waitFor(() => expect(field).toHaveValue(''))
    expect(await screen.findByText('A token is saved.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(FAKE_TOKEN)
    expect(
      screen.getByRole('button', { name: /Get the Playwright extension/ })
    ).toBeInTheDocument()
  })

  it('tests the extension connection', async () => {
    current = status({ engine: 'playwright_extension', hasToken: true })
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByText('Test connection'))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('test_browser_connection', {
        extension: true,
        token: null,
      })
    )
    expect(await screen.findByText(/Connected\. Open tabs/)).toBeInTheDocument()
  })

  it('offers to take over a hand-made Playwright server', async () => {
    current = status({
      engine: 'playwright',
      handMade: [
        {
          backend: 'claude',
          serverName: 'browser',
          path: '/home/.claude.json',
        },
      ],
    })
    const user = userEvent.setup()
    renderSection()
    expect(
      await screen.findByText('You already set up Playwright yourself')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Take over' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_browser_engine', {
        engine: 'playwright',
        backends: ['claude', 'codex'],
        takeOver: true,
      })
    )
  })

  it('is read-only in Web Access: no token field, no actions', async () => {
    mocks.local = false
    current = status({ engine: 'playwright_extension', hasToken: true })
    renderSection()
    expect(
      await screen.findByTestId('browser-engine-read-only')
    ).toBeInTheDocument()
    for (const radio of await screen.findAllByRole('radio')) {
      expect(radio).toBeDisabled()
    }
    expect(screen.queryByLabelText('Connection token')).toBeNull()
    expect(screen.queryByText('Test connection')).toBeNull()
    expect(screen.getByTestId('browser-engine-warning')).toBeInTheDocument()
    expect(screen.getByText('A token is saved.')).toBeInTheDocument()
  })
})
