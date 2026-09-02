import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { UsagePopover } from './UsagePopover'
import { useUIStore } from '@/store/ui-store'

const mocks = vi.hoisted(() => ({
  useClaudeCliStatus: vi.fn(),
  useClaudeCliAuth: vi.fn(),
  useClaudeUsage: vi.fn(),
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

    expect(screen.getByRole('button', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
  })

  it('shows the usage pane without the preferences search anchors', async () => {
    const user = userEvent.setup()
    render(<UsagePopover />)

    await user.click(screen.getByRole('button', { name: 'Usage' }))

    expect(await screen.findByText('Claude')).toBeInTheDocument()
    expect(document.getElementById('pref-usage-section-claude')).toBeNull()
  })

  it('opens the Settings usage pane and closes itself', async () => {
    const user = userEvent.setup()
    render(<UsagePopover />)

    await user.click(screen.getByRole('button', { name: 'Usage' }))
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    const state = useUIStore.getState()
    expect(state.preferencesOpen).toBe(true)
    expect(state.preferencesPane).toBe('usage')
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
  })
})
