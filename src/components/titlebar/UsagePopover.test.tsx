import type * as PreferencesService from '@/services/preferences'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { UsagePopover, findPeakUsage } from './UsagePopover'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'

const mocks = vi.hoisted(() => ({
  useClaudeCliStatus: vi.fn(),
  useClaudeCliAuth: vi.fn(),
  useSession: vi.fn(),
  useClaudeUsage: vi.fn(),
  // Usage per Claude account id; falls back to useClaudeUsage for one account.
  useClaudeAccountUsage: vi.fn(),
  usePreferences: vi.fn(),
  patchPreferences: vi.fn(),
  useCodexCliStatus: vi.fn(),
  useCodexCliAuth: vi.fn(),
  useCodexUsage: vi.fn(),
  useGrokCliStatus: vi.fn(),
  useGrokCliAuth: vi.fn(),
  useGrokUsage: vi.fn(),
}))

vi.mock('@/services/chat', () => ({
  useSession: () => mocks.useSession(),
}))

vi.mock('@/services/claude-cli', () => ({
  claudeCliQueryKeys: { all: ['claude-cli'] },
  useClaudeCliStatus: () => mocks.useClaudeCliStatus(),
  useClaudeCliAuth: () => mocks.useClaudeCliAuth(),
  useClaudeAccountAuth: () => mocks.useClaudeCliAuth(),
  useClaudeUsage: (options?: { accountId?: string }) =>
    (options?.accountId && mocks.useClaudeAccountUsage(options.accountId)) ??
    mocks.useClaudeUsage(),
  useClaudeAccountsUsage: (ids: string[]) =>
    ids.map(id => mocks.useClaudeAccountUsage(id) ?? mocks.useClaudeUsage()),
}))

vi.mock('@/services/preferences', async importOriginal => ({
  ...(await importOriginal<typeof PreferencesService>()),
  usePreferences: () => mocks.usePreferences(),
  usePatchPreferences: () => ({
    mutate: mocks.patchPreferences,
    isPending: false,
  }),
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

describe('UsagePopover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      activeWorktreeId: null,
      activeSessionIds: {},
      selectedBackends: {},
      worktreePaths: {},
    })
    mocks.useSession.mockReturnValue({ data: undefined })
    mocks.usePreferences.mockReturnValue({ data: undefined })
    mocks.useClaudeAccountUsage.mockReturnValue(undefined)
    mocks.useClaudeCliStatus.mockReturnValue(
      idleQuery({ installed: true, version: '1.0.0', path: '/usr/bin/claude' })
    )
    mocks.useClaudeCliAuth.mockReturnValue(
      idleQuery({ authenticated: true, error: null })
    )
    mocks.useClaudeUsage.mockReturnValue(
      idleQuery({
        planType: 'pro',
        session: {
          usedPercent: 22,
          resetsAt: Math.floor(Date.now() / 1000) + 3600,
        },
        weekly: null,
        fetchedAt: Math.floor(Date.now() / 1000),
      })
    )
    mocks.useCodexCliStatus.mockReturnValue(idleQuery({ installed: false }))
    mocks.useCodexCliAuth.mockReturnValue(idleQuery({ authenticated: false }))
    mocks.useCodexUsage.mockReturnValue(idleQuery())
    mocks.useGrokCliStatus.mockReturnValue(idleQuery({ installed: false }))
    mocks.useGrokCliAuth.mockReturnValue(idleQuery({ authenticated: false }))
    mocks.useGrokUsage.mockReturnValue(idleQuery())
  })

  it('keeps the usage pane closed until the button is clicked', () => {
    render(<UsagePopover />)

    expect(screen.getByRole('button', { name: /^Usage/ })).toBeInTheDocument()
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
  })

  it('shows the usage pane without the preferences search anchors', async () => {
    const user = userEvent.setup()
    render(<UsagePopover />)

    await user.click(screen.getByRole('button', { name: /^Usage/ }))

    expect(await screen.findByText('Claude')).toBeInTheDocument()
    expect(document.getElementById('pref-usage-section-claude')).toBeNull()
  })

  it('opens the Settings usage pane and closes itself', async () => {
    const user = userEvent.setup()
    render(<UsagePopover />)

    await user.click(screen.getByRole('button', { name: /^Usage/ }))
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    const state = useUIStore.getState()
    expect(state.preferencesOpen).toBe(true)
    expect(state.preferencesPane).toBe('usage')
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
  })

  const signInCodex = () => {
    mocks.useCodexCliStatus.mockReturnValue(idleQuery({ installed: true }))
    mocks.useCodexCliAuth.mockReturnValue(idleQuery({ authenticated: true }))
    mocks.useCodexUsage.mockReturnValue(
      idleQuery({
        session: { usedPercent: 12, resetsAt: null },
        weekly: { usedPercent: 91.4, resetsAt: null },
        fetchedAt: 0,
      })
    )
  }

  const openSession = (backend: string, claudeAccountId?: string) => {
    useChatStore.setState({
      activeWorktreeId: 'wt',
      activeSessionIds: { wt: 'sess' },
      worktreePaths: { wt: '/repo' },
    })
    mocks.useSession.mockReturnValue({
      data: { backend, claude_account_id: claudeAccountId },
    })
  }

  it('without a session shows the default backend and counts the others', () => {
    mocks.useClaudeUsage.mockReturnValue(
      idleQuery({
        session: { usedPercent: 22, resetsAt: null },
        weekly: { usedPercent: 64, resetsAt: null },
        fetchedAt: 0,
      })
    )
    signInCodex()

    render(<UsagePopover />)

    const trigger = screen.getByRole('button', {
      name: 'Usage, Claude · Weekly 64%, 1 more backend',
    })
    expect(trigger).toHaveTextContent('64%')
    expect(screen.getByTestId('titlebar-usage-more')).toHaveTextContent('+1')
    expect(trigger).not.toContainElement(
      screen.getByTestId('titlebar-usage-more')
    )
  })

  it('counts a full model limit such as Fable', () => {
    mocks.useClaudeUsage.mockReturnValue(
      idleQuery({
        session: null,
        weekly: { usedPercent: 85, resetsAt: null },
        limits: [
          {
            kind: 'weekly_scoped',
            usedPercent: 100,
            severity: 'critical',
            resetsAt: null,
            model: 'Fable',
          },
        ],
        fetchedAt: 0,
      })
    )

    render(<UsagePopover />)

    expect(
      screen.getByRole('button', { name: 'Usage, Claude · Fable 100%' })
    ).toBeInTheDocument()
  })

  it('follows the backend of the open session', () => {
    signInCodex()
    openSession('codex')

    render(<UsagePopover />)

    const trigger = screen.getByRole('button', {
      name: 'Usage, Codex · Weekly 91%, 1 more backend',
    })
    expect(trigger.querySelector('svg.text-destructive')).not.toBeNull()
    expect(screen.getByTestId('titlebar-usage-header')).toBeInTheDocument()
  })

  it('uses the active Claude account, not the one the open session last ran on (#131)', () => {
    mocks.usePreferences.mockReturnValue({
      data: {
        claude_root_label: 'Personal',
        claude_accounts: [
          { id: 'acc-work', label: 'Work', config_dir: '/u/.claude-work' },
        ],
        claude_active_account: 'acc-work',
      },
    })
    mocks.useClaudeAccountUsage.mockImplementation((id: string) =>
      idleQuery({
        session: { usedPercent: id === 'root' ? 35 : 80, resetsAt: null },
        weekly: null,
        fetchedAt: 0,
      })
    )
    openSession('claude', 'root')

    render(<UsagePopover />)

    expect(
      screen.getByRole('button', {
        name: 'Usage, Claude Work · Session 80%',
      })
    ).toBeInTheDocument()
  })

  it('shows no figure for a backend without usage data, but counts others', () => {
    openSession('cursor')

    render(<UsagePopover />)

    const trigger = screen.getByRole('button', {
      name: 'Usage, 1 more backend',
    })
    expect(trigger).not.toHaveTextContent('%')
    expect(screen.getByTestId('titlebar-usage-more')).toHaveTextContent('+1')
  })

  it('shows the active Claude account, even when another is higher', () => {
    mocks.useClaudeCliStatus.mockReturnValue(idleQuery({ installed: true }))
    mocks.useClaudeCliAuth.mockReturnValue(idleQuery({ authenticated: true }))
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
    mocks.useClaudeAccountUsage.mockImplementation((id: string) =>
      idleQuery({
        session: { usedPercent: id === 'acc-work' ? 20 : 83, resetsAt: null },
        weekly: { usedPercent: 10, resetsAt: null },
        fetchedAt: 0,
      })
    )

    render(<UsagePopover />)

    expect(
      screen.getByRole('button', { name: 'Usage, Claude Work · Session 20%' })
    ).toBeInTheDocument()
  })

  it('ignores backends that are not signed in', () => {
    mocks.useCodexCliStatus.mockReturnValue(idleQuery({ installed: true }))
    mocks.useCodexCliAuth.mockReturnValue(idleQuery({ authenticated: false }))
    mocks.useCodexUsage.mockReturnValue(
      idleQuery({
        session: { usedPercent: 99, resetsAt: null },
        weekly: null,
        fetchedAt: 0,
      })
    )

    render(<UsagePopover />)

    expect(
      screen.getByRole('button', { name: 'Usage, Claude · Session 22%' })
    ).toBeInTheDocument()
  })

  it('falls back to a plain icon when no usage is known', () => {
    mocks.useClaudeUsage.mockReturnValue(idleQuery())

    render(<UsagePopover />)

    const trigger = screen.getByRole('button', { name: 'Usage' })
    expect(trigger).not.toHaveTextContent('%')
  })
})

describe('findPeakUsage', () => {
  it('returns the highest window and clamps it to 0-100', () => {
    expect(
      findPeakUsage([
        { label: 'a', usage: { usedPercent: 40 } },
        { label: 'b', usage: { usedPercent: 130 } },
        { label: 'c', usage: { usedPercent: 70 } },
      ])
    ).toEqual({ label: 'b', percent: 100 })
  })

  it('skips missing windows and keeps the first of equal values', () => {
    expect(
      findPeakUsage([
        { label: 'a', usage: null },
        { label: 'b', usage: { usedPercent: 50 } },
        { label: 'c', usage: undefined },
        { label: 'd', usage: { usedPercent: 50 } },
      ])
    ).toEqual({ label: 'b', percent: 50 })
  })

  it('returns null when no window has data', () => {
    expect(findPeakUsage([{ label: 'a', usage: null }])).toBeNull()
    expect(findPeakUsage([])).toBeNull()
  })
})
