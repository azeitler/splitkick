import type * as PreferencesService from '@/services/preferences'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { UsagePopover, findPeakUsage } from './UsagePopover'
import { useUIStore } from '@/store/ui-store'

const mocks = vi.hoisted(() => ({
  useClaudeCliStatus: vi.fn(),
  useClaudeCliAuth: vi.fn(),
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

vi.mock('@/services/claude-cli', () => ({
  claudeCliQueryKeys: { all: ['claude-cli'] },
  useClaudeCliStatus: () => mocks.useClaudeCliStatus(),
  useClaudeCliAuth: () => mocks.useClaudeCliAuth(),
  useClaudeUsage: () => mocks.useClaudeUsage(),
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

  it('shows the highest session or weekly figure across backends', () => {
    mocks.useClaudeUsage.mockReturnValue(
      idleQuery({
        session: { usedPercent: 22, resetsAt: null },
        weekly: { usedPercent: 64, resetsAt: null },
        fetchedAt: 0,
      })
    )
    mocks.useCodexCliStatus.mockReturnValue(idleQuery({ installed: true }))
    mocks.useCodexCliAuth.mockReturnValue(idleQuery({ authenticated: true }))
    mocks.useCodexUsage.mockReturnValue(
      idleQuery({
        session: { usedPercent: 12, resetsAt: null },
        weekly: { usedPercent: 91.4, resetsAt: null },
        fetchedAt: 0,
      })
    )

    render(<UsagePopover />)

    const trigger = screen.getByRole('button', {
      name: 'Usage, Codex · Weekly 91%',
    })
    expect(trigger).toHaveTextContent('91%')
    expect(trigger.querySelector('svg')).toHaveClass('text-destructive')
  })

  it('takes the peak across every Claude account and names it', () => {
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
      },
    })
    mocks.useClaudeAccountUsage.mockImplementation((id: string) =>
      idleQuery({
        session: { usedPercent: id === 'acc-work' ? 83 : 20, resetsAt: null },
        weekly: { usedPercent: 10, resetsAt: null },
        fetchedAt: 0,
      })
    )

    render(<UsagePopover />)

    expect(
      screen.getByRole('button', { name: 'Usage, Claude Work · Session 83%' })
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
