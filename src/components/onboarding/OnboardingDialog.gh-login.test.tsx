/**
 * GitHub login in onboarding with the real gh-cli query hooks: only the
 * transport (backend commands) and the login terminal are faked.
 */
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/store/ui-store'
import type * as PlatformModule from '@/lib/platform'
import type * as EnvironmentModule from '@/lib/environment'
import type * as CliSetupComponentsModule from './CliSetupComponents'

const remoteServer = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/lib/remote-install', () => ({
  REMOTE_INSTALL_ENABLED: true,
  get REMOTE_SERVER_ENABLED() {
    return remoteServer.enabled
  },
}))

const mocks = vi.hoisted(() => ({
  nativeApp: true,
  cursorInstalled: false,
  cursorAuthenticated: false,
  cursorAuthRefetchCount: 0,
  cursorInstallSucceeds: true,
  patchPreferences: vi.fn(
    (_patch: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.()
  ),
  patchPreferencesAsync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof EnvironmentModule>()),
  isNativeApp: () => mocks.nativeApp,
  hasBackendTransport: () => true,
}))

function setupResult(installed = false, path: string | null = null) {
  return {
    status: { installed, version: installed ? '1.0.0' : null, path },
    isStatusLoading: false,
    versions: [],
    isVersionsLoading: false,
    isVersionsError: false,
    refetchVersions: vi.fn(),
    isInstalling: false,
    installError: null,
    progress: null,
    install: vi.fn(),
    refetchStatus: vi.fn(),
  }
}

function authResult(authenticated = false) {
  return {
    data: { authenticated },
    isLoading: false,
    isFetching: false,
    status: 'success',
    fetchStatus: 'idle',
    error: null,
    refetch: vi.fn().mockResolvedValue({ data: { authenticated } }),
  }
}

function pathResult(found = false, path: string | null = null) {
  return {
    data: { found, path, version: found ? '1.0.0' : null },
  }
}

vi.mock('@/services/claude-cli', () => ({
  useClaudeCliSetup: () => setupResult(),
  useClaudeCliAuth: () => authResult(),
  useClaudePathDetection: () => pathResult(),
}))

vi.mock('@/services/codex-cli', () => ({
  useCodexCliSetup: () => setupResult(),
  useCodexCliAuth: () => authResult(),
  useCodexPathDetection: () => pathResult(),
}))

vi.mock('@/services/opencode-cli', () => ({
  useOpenCodeCliSetup: () => setupResult(),
  useOpenCodeCliAuth: () => authResult(),
  useOpenCodePathDetection: () => pathResult(),
}))

vi.mock('@/services/cursor-cli', () => ({
  getCursorInstallCommand: vi.fn().mockResolvedValue({
    command: '/bin/sh',
    args: ['-c', 'install-cursor'],
  }),
  useCursorPathDetection: () => pathResult(),
  useCursorCliStatus: () => ({
    data: {
      installed: mocks.cursorInstalled,
      version: null,
      path: mocks.cursorInstalled ? '/home/test/.local/bin/agent' : null,
    },
    isLoading: false,
    refetch: vi.fn().mockImplementation(async () => {
      mocks.cursorInstalled = mocks.cursorInstallSucceeds
      return {
        data: {
          installed: mocks.cursorInstalled,
          version: null,
          path: mocks.cursorInstalled ? '/home/test/.local/bin/agent' : null,
        },
      }
    }),
  }),
  useCursorCliAuth: () => ({
    ...authResult(mocks.cursorAuthenticated),
    refetch: vi.fn().mockImplementation(async () => {
      mocks.cursorAuthRefetchCount += 1
      mocks.cursorAuthenticated =
        mocks.cursorInstalled && mocks.cursorAuthRefetchCount >= 2
      return { data: { authenticated: mocks.cursorAuthenticated } }
    }),
  }),
}))

vi.mock('@/services/pi-cli', () => ({
  usePiCliSetup: () => setupResult(),
  usePiCliAuth: () => authResult(),
  usePiPathDetection: () => pathResult(),
}))

vi.mock('@/services/commandcode-cli', () => ({
  useCommandCodeCliSetup: () => setupResult(),
  useCommandCodeCliAuth: () => authResult(),
  useCommandCodePathDetection: () => pathResult(),
}))

vi.mock('@/services/grok-cli', () => ({
  useGrokCliSetup: () => setupResult(),
  useGrokCliAuth: () => authResult(),
  useGrokPathDetection: () => pathResult(),
}))

vi.mock('@/services/kimi-cli', () => ({
  useKimiCliSetup: () => setupResult(),
  useKimiCliAuth: () => authResult(),
  useKimiPathDetection: () => pathResult(),
}))

vi.mock('@/services/antigravity-cli', () => ({
  useAntigravityCliSetup: () => setupResult(),
  useAntigravityCliAuth: () => authResult(),
  useAntigravityPathDetection: () => pathResult(),
}))

const gh = vi.hoisted(() => ({
  source: 'jean' as string,
  loggedIn: false,
  loginMounts: 0,
  authCalls: 0,
  loginSucceeds: true,
  authError: 'not logged in',
  log: [] as string[],
}))
vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWsConnectionStatus: () => true,
  listen: vi.fn().mockResolvedValue(() => undefined),
  invoke: vi.fn(async (cmd: string) => {
    gh.log.push(cmd)
    switch (cmd) {
      case 'check_gh_cli_installed':
        return gh.source === 'path'
          ? { installed: true, version: '2.1', path: '/opt/homebrew/bin/gh' }
          : { installed: false, version: null, path: null }
      case 'check_gh_cli_auth':
        gh.authCalls += 1
        return gh.loggedIn
          ? { authenticated: true, error: null }
          : { authenticated: false, error: gh.authError }
      case 'detect_gh_in_path':
        return {
          found: true,
          path: '/opt/homebrew/bin/gh',
          version: '2.1',
          package_manager: 'homebrew',
        }
      case 'get_available_gh_versions':
        return []
      default:
        return null
    }
  }),
}))

vi.mock('@/services/prerequisites', () => ({
  checkSystemPrerequisites: vi.fn().mockResolvedValue({
    gitInstalled: true,
    gitVersion: '2.50.0',
    nodeInstalled: true,
    nodeVersion: '24.0.0',
    npmInstalled: true,
    npmVersion: '11.0.0',
    platform: 'linux',
    automaticInstallSupported: false,
    automaticInstallCommand: null,
    manualInstallUrl: 'https://nodejs.org/en/download',
  }),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      wsl_mode_chosen: true,
      claude_cli_source: 'path',
      codex_cli_source: 'path',
      opencode_cli_source: 'path',
      pi_cli_source: 'path',
      commandcode_cli_source: 'path',
      grok_cli_source: 'path',
      kimi_cli_source: 'path',
      antigravity_cli_source: 'path',
      gh_cli_source: 'path',
    },
  }),
  usePatchPreferences: () => ({
    mutate: (
      patch: { gh_cli_source?: string },
      o?: { onSuccess?: () => void }
    ) => {
      if (patch.gh_cli_source) gh.source = patch.gh_cli_source
      o?.onSuccess?.()
    },
    mutateAsync: mocks.patchPreferencesAsync,
  }),
}))

vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<typeof PlatformModule>()),
  isServerWindows: () => false,
}))

vi.mock('./CliSetupComponents', async importOriginal => {
  const original = await importOriginal<typeof CliSetupComponentsModule>()
  return {
    ...original,
    AuthLoginState: ({
      action = 'login',
      onComplete,
      cliName,
    }: {
      action?: 'login' | 'install'
      onComplete: () => void
      cliName?: string
    }) => {
      if (cliName === 'GitHub CLI') gh.loginMounts += 1
      return (
        <button
          onClick={() => {
            if (cliName === 'GitHub CLI') gh.loggedIn = gh.loginSucceeds
            onComplete()
          }}
        >
          Complete {cliName} {action}
        </button>
      )
    },
    AuthCheckingState: ({ cliName }: { cliName: string }) => (
      <div>Checking {cliName}</div>
    ),
    CliPathSelector: ({
      cliName,
      onSelectPath,
    }: {
      cliName: string
      onSelectPath: () => void
    }) => <button onClick={onSelectPath}>Use {cliName} from PATH</button>,
  }
})

describe('OnboardingDialog GitHub login', () => {
  beforeEach(() => {
    gh.source = 'jean'
    gh.loggedIn = false
    gh.loginSucceeds = true
    gh.authError = 'not logged in'
    gh.loginMounts = 0
    gh.authCalls = 0
    gh.log = []
    useUIStore.setState({
      onboardingOpen: true,
      onboardingStartStep: 'gh',
      onboardingManuallyTriggered: true,
      onboardingDismissed: false,
    })
  })

  it('checks the login right after it finishes and completes', async () => {
    const user = userEvent.setup()
    const { OnboardingDialog } = await import('./OnboardingDialog')
    render(<OnboardingDialog />)

    await user.click(
      await screen.findByRole('button', { name: 'Use GitHub CLI from PATH' })
    )
    await user.click(
      await screen.findByRole('button', { name: 'Complete GitHub CLI login' })
    )

    expect(await screen.findByText('All Tools Ready')).toBeInTheDocument()
    expect(gh.loginMounts).toBe(1)
    expect(gh.authCalls).toBe(2)
  })

  it('shows the check error instead of reopening the login in a loop', async () => {
    gh.loginSucceeds = false
    gh.authError =
      'GitHub CLI has a saved login, but GitHub did not confirm it.'
    const user = userEvent.setup()
    const { OnboardingDialog } = await import('./OnboardingDialog')
    render(<OnboardingDialog />)

    await user.click(
      await screen.findByRole('button', { name: 'Use GitHub CLI from PATH' })
    )
    await user.click(
      await screen.findByRole('button', { name: 'Complete GitHub CLI login' })
    )

    expect(
      await screen.findByText('GitHub CLI Login Not Confirmed')
    ).toBeInTheDocument()
    expect(screen.getByText(gh.authError)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Complete GitHub CLI login' })
    ).not.toBeInTheDocument()
    expect(gh.loginMounts).toBe(1)

    // Check Again re-runs the check only; it never starts a login by itself.
    await user.click(screen.getByRole('button', { name: 'Check Again' }))
    expect(
      await screen.findByText('GitHub CLI Login Not Confirmed')
    ).toBeInTheDocument()
    expect(gh.authCalls).toBe(3)
    expect(gh.loginMounts).toBe(1)

    // Log In Again starts one new login; when that works, setup completes.
    gh.loginSucceeds = true
    await user.click(screen.getByRole('button', { name: 'Log In Again' }))
    await user.click(
      await screen.findByRole('button', { name: 'Complete GitHub CLI login' })
    )
    expect(await screen.findByText('All Tools Ready')).toBeInTheDocument()
    expect(gh.loginMounts).toBe(2)
  })

  it('skips the GitHub CLI setup and goes to Done', async () => {
    const user = userEvent.setup()
    const { OnboardingDialog } = await import('./OnboardingDialog')
    render(<OnboardingDialog />)

    await screen.findByRole('button', { name: 'Use GitHub CLI from PATH' })
    await user.click(
      screen.getByRole('button', { name: /Skip, I don't use GitHub/ })
    )

    expect(await screen.findByText('All Tools Ready')).toBeInTheDocument()
    expect(screen.getByText(/GitHub CLI: not set up/)).toBeInTheDocument()
    expect(gh.loginMounts).toBe(0)
  })

  it('skips the GitHub login while the login is open', async () => {
    const user = userEvent.setup()
    const { OnboardingDialog } = await import('./OnboardingDialog')
    render(<OnboardingDialog />)

    await user.click(
      await screen.findByRole('button', { name: 'Use GitHub CLI from PATH' })
    )
    await screen.findByRole('button', { name: 'Complete GitHub CLI login' })
    await user.click(
      screen.getByRole('button', { name: /Skip, I don't use GitHub/ })
    )

    expect(await screen.findByText('All Tools Ready')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Complete GitHub CLI login' })
    ).not.toBeInTheDocument()
  })
})
