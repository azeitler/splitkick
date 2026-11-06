import type * as PreferencesService from '@/services/preferences'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { UsagePane } from './UsagePane'

const mocks = vi.hoisted(() => ({
  useClaudeCliStatus: vi.fn(),
  useClaudeCliAuth: vi.fn(),
  useClaudeUsage: vi.fn(),
  // Usage per Claude account id; falls back to useClaudeUsage for one account.
  useClaudeAccountUsage: vi.fn(),
  usePreferences: vi.fn(),
  useCodexCliStatus: vi.fn(),
  useCodexCliAuth: vi.fn(),
  useCodexUsage: vi.fn(),
  useGrokCliStatus: vi.fn(),
  useGrokCliAuth: vi.fn(),
  useGrokUsage: vi.fn(),
}))

vi.mock('@/services/claude-cli', () => ({
  useClaudeCliStatus: () => mocks.useClaudeCliStatus(),
  useClaudeCliAuth: () => mocks.useClaudeCliAuth(),
  useClaudeUsage: () => mocks.useClaudeUsage(),
  useClaudeAccountsUsage: (ids: string[]) =>
    ids.map(id => mocks.useClaudeAccountUsage(id) ?? mocks.useClaudeUsage()),
}))

vi.mock('@/services/preferences', async importOriginal => ({
  ...(await importOriginal<typeof PreferencesService>()),
  usePreferences: () => mocks.usePreferences(),
}))

vi.mock('@/services/codex-cli', () => ({
  useCodexCliStatus: () => mocks.useCodexCliStatus(),
  useCodexCliAuth: () => mocks.useCodexCliAuth(),
  useCodexUsage: () => mocks.useCodexUsage(),
}))

vi.mock('@/services/grok-cli', () => ({
  useGrokCliStatus: () => mocks.useGrokCliStatus(),
  useGrokCliAuth: () => mocks.useGrokCliAuth(),
  useGrokUsage: () => mocks.useGrokUsage(),
}))

function idleQuery(data: unknown = undefined) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
}

describe('UsagePane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePreferences.mockReturnValue({ data: undefined })
    mocks.useClaudeAccountUsage.mockReturnValue(undefined)
    mocks.useClaudeCliStatus.mockReturnValue(
      idleQuery({ installed: true, version: '1.0.0', path: '/usr/bin/claude' })
    )
    mocks.useClaudeCliAuth.mockReturnValue(
      idleQuery({ authenticated: true, error: null })
    )
    mocks.useClaudeUsage.mockReturnValue(idleQuery())
    mocks.useCodexCliStatus.mockReturnValue(
      idleQuery({ installed: true, version: '1.0.0', path: '/usr/bin/codex' })
    )
    mocks.useCodexCliAuth.mockReturnValue(
      idleQuery({ authenticated: true, error: null })
    )
    mocks.useCodexUsage.mockReturnValue(idleQuery())
    mocks.useGrokCliStatus.mockReturnValue(
      idleQuery({ installed: true, version: '0.2.103', path: '/usr/bin/grok' })
    )
    mocks.useGrokCliAuth.mockReturnValue(
      idleQuery({ authenticated: true, error: null, timedOut: false })
    )
    mocks.useGrokUsage.mockReturnValue(idleQuery())
  })

  it('renders Claude plan summary and usage windows', () => {
    mocks.useClaudeUsage.mockReturnValue(
      idleQuery({
        planType: 'pro',
        accountEmail: 'claude@example.com',
        session: {
          usedPercent: 22,
          resetsAt: Math.floor(Date.now() / 1000) + 3600,
        },
        weekly: {
          usedPercent: 55,
          resetsAt: Math.floor(Date.now() / 1000) + 86_400,
        },
        sonnetWeekly: {
          usedPercent: 10,
          resetsAt: Math.floor(Date.now() / 1000) + 86_400,
        },
        extraUsageSpent: 1.5,
        extraUsageLimit: 50,
        fetchedAt: Math.floor(Date.now() / 1000) - 30,
      })
    )

    render(<UsagePane />)

    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('pro')).toBeInTheDocument()
    expect(screen.getByText('Extra: 1.5 / 50')).toBeInTheDocument()
    expect(screen.getByText('claude@example.com')).toBeInTheDocument()
    expect(
      screen.getByTitle('claude@example.com · pro · Extra: 1.5 / 50')
    ).toBeInTheDocument()
    expect(screen.getByText('Session')).toBeInTheDocument()
    expect(screen.getByText('Sonnet')).toBeInTheDocument()
  })

  it('renders Codex plan summary and usage windows', () => {
    mocks.useCodexUsage.mockReturnValue(
      idleQuery({
        planType: 'pro',
        accountEmail: 'codex@example.com',
        session: {
          usedPercent: 12.5,
          resetsAt: Math.floor(Date.now() / 1000) + 3600,
          limitWindowSeconds: 3600,
        },
        weekly: {
          usedPercent: 40,
          resetsAt: Math.floor(Date.now() / 1000) + 86_400,
          limitWindowSeconds: 604_800,
        },
        reviews: null,
        creditsRemaining: 3,
        rateLimitReachedType: null,
        modelLimits: [],
        fetchedAt: Math.floor(Date.now() / 1000) - 30,
      })
    )

    render(<UsagePane />)

    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('Credits remaining: 3')).toBeInTheDocument()
    expect(screen.getByText('codex@example.com')).toBeInTheDocument()
    expect(screen.getByText('12.5%')).toBeInTheDocument()
  })

  it('hides backends that are not installed or not authenticated', () => {
    mocks.useClaudeCliStatus.mockReturnValue(
      idleQuery({ installed: false, version: null, path: null })
    )
    mocks.useClaudeCliAuth.mockReturnValue(
      idleQuery({ authenticated: false, error: null })
    )
    mocks.useCodexCliAuth.mockReturnValue(
      idleQuery({ authenticated: false, error: null })
    )
    mocks.useGrokUsage.mockReturnValue(
      idleQuery({
        planType: 'X Premium+',
        session: { usedPercent: 10, resetsAt: null, limitWindowSeconds: null },
        weekly: { usedPercent: 20, resetsAt: null, limitWindowSeconds: null },
        products: [],
        frequentUsed: null,
        frequentLimit: null,
        occasionalUsed: null,
        occasionalLimit: null,
        hasGrokCodeAccess: true,
        periodStart: null,
        periodEnd: null,
        fetchedAt: Math.floor(Date.now() / 1000),
      })
    )

    render(<UsagePane />)

    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
    expect(screen.queryByText('Codex')).not.toBeInTheDocument()
    expect(screen.queryByText(/not authenticated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not installed/i)).not.toBeInTheDocument()
    expect(screen.getByText('Grok')).toBeInTheDocument()
    expect(screen.getByText('X Premium+')).toBeInTheDocument()
  })

  it('shows empty guidance when no ready backends exist', () => {
    mocks.useClaudeCliStatus.mockReturnValue(
      idleQuery({ installed: false, version: null, path: null })
    )
    mocks.useClaudeCliAuth.mockReturnValue(
      idleQuery({ authenticated: false, error: null })
    )
    mocks.useCodexCliStatus.mockReturnValue(
      idleQuery({ installed: false, version: null, path: null })
    )
    mocks.useCodexCliAuth.mockReturnValue(
      idleQuery({ authenticated: false, error: null })
    )
    mocks.useGrokCliStatus.mockReturnValue(
      idleQuery({ installed: false, version: null, path: null })
    )
    mocks.useGrokCliAuth.mockReturnValue(
      idleQuery({ authenticated: false, error: null, timedOut: false })
    )

    render(<UsagePane />)

    expect(
      screen.getByText(/No AI backends with usage are installed and signed in/i)
    ).toBeInTheDocument()
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
    expect(screen.queryByText('Codex')).not.toBeInTheDocument()
    expect(screen.queryByText('Grok')).not.toBeInTheDocument()
  })

  it('renders Grok build and weekly usage', () => {
    mocks.useGrokUsage.mockReturnValue(
      idleQuery({
        planType: 'X Premium+',
        session: {
          usedPercent: 68,
          resetsAt: Math.floor(Date.now() / 1000) + 86_400,
          limitWindowSeconds: null,
        },
        weekly: {
          usedPercent: 72,
          resetsAt: Math.floor(Date.now() / 1000) + 86_400,
          limitWindowSeconds: null,
        },
        products: [
          { product: 'GrokBuild', usedPercent: 68 },
          { product: 'GrokChat', usedPercent: 4 },
        ],
        frequentUsed: 1,
        frequentLimit: 10,
        occasionalUsed: 2,
        occasionalLimit: 30,
        hasGrokCodeAccess: true,
        periodStart: '2026-07-13T06:53:23Z',
        periodEnd: '2026-07-20T06:53:23Z',
        fetchedAt: Math.floor(Date.now() / 1000),
      })
    )

    render(<UsagePane />)

    expect(screen.getByText('Grok')).toBeInTheDocument()
    expect(screen.getByText('X Premium+')).toBeInTheDocument()
    expect(screen.getByText('Grok Build')).toBeInTheDocument()
    expect(screen.getByText('Weekly credits')).toBeInTheDocument()
    expect(screen.getByText('Grok Code access: Yes')).toBeInTheDocument()
    expect(screen.getByText(/Frequent: 1 \/ 10/)).toBeInTheDocument()
  })

  it('keeps the preferences search anchors by default', () => {
    render(<UsagePane />)

    expect(document.getElementById('pref-usage-section-claude')).not.toBeNull()
    expect(document.getElementById('pref-usage-section-codex')).not.toBeNull()
    expect(document.getElementById('pref-usage-section-grok')).not.toBeNull()
  })

  it('drops the anchors when withSectionIds is false', () => {
    render(<UsagePane withSectionIds={false} />)

    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(document.getElementById('pref-usage-section-claude')).toBeNull()
    expect(document.getElementById('pref-usage-section-codex')).toBeNull()
    expect(document.getElementById('pref-usage-section-grok')).toBeNull()
  })

  it('retries Claude usage on error', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mocks.useClaudeUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error('network down'),
      refetch,
    })

    render(<UsagePane />)

    expect(screen.getByText('network down')).toBeInTheDocument()
    const retryButton = screen.getByRole('button', { name: /Retry/i })
    await user.click(retryButton)
    expect(refetch).toHaveBeenCalled()
  })

  it('shows the limits of every Claude account with its label and email', () => {
    mocks.usePreferences.mockReturnValue({
      data: {
        claude_root_label: 'Personal',
        claude_accounts: [
          {
            id: 'acc-work',
            label: 'Work',
            config_dir: '/Users/me/.claude-work',
          },
        ],
        claude_active_account: 'acc-work',
      },
    })
    // Not signed in on the root install: the pane still lists the other account.
    mocks.useClaudeCliAuth.mockReturnValue(
      idleQuery({ authenticated: false, error: null })
    )
    const usage = (email: string, session: number) =>
      idleQuery({
        planType: 'max',
        accountEmail: email,
        session: { usedPercent: session, resetsAt: null },
        weekly: { usedPercent: 5, resetsAt: null },
        sonnetWeekly: null,
        extraUsageSpent: null,
        extraUsageLimit: null,
        fetchedAt: Math.floor(Date.now() / 1000) - 30,
      })
    mocks.useClaudeAccountUsage.mockImplementation((id: string) =>
      id === 'root' ? usage('me@personal.test', 11) : usage('me@work.test', 77)
    )

    render(<UsagePane />)

    const root = screen.getByTestId('claude-usage-account-root')
    const work = screen.getByTestId('claude-usage-account-acc-work')
    expect(root).toHaveTextContent('Personal')
    expect(root).toHaveTextContent('me@personal.test')
    expect(root).toHaveTextContent('11.0%')
    expect(root).not.toHaveTextContent('active')
    expect(work).toHaveTextContent('Work')
    expect(work).toHaveTextContent('active')
    expect(work).toHaveTextContent('me@work.test')
    expect(work).toHaveTextContent('77.0%')
  })

  it('shows why a signed-out Claude account has no limits', () => {
    mocks.usePreferences.mockReturnValue({
      data: {
        claude_accounts: [
          {
            id: 'acc-work',
            label: 'Work',
            config_dir: '/Users/me/.claude-work',
          },
        ],
      },
    })
    mocks.useClaudeAccountUsage.mockImplementation((id: string) =>
      id === 'acc-work'
        ? {
            ...idleQuery(),
            isError: true,
            error:
              'Claude credentials not found. Run `claude` to authenticate.',
          }
        : idleQuery()
    )

    render(<UsagePane />)

    expect(
      screen.getByTestId('claude-usage-account-acc-work')
    ).toHaveTextContent('Claude credentials not found')
    expect(screen.getByTestId('claude-usage-account-root')).toHaveTextContent(
      'Default'
    )
  })
})
