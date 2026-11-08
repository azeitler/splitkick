import type * as PreferencesService from '@/services/preferences'
import type * as ClaudeCliService from '@/services/claude-cli'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { ClaudeAccountsSection } from './ClaudeAccountsSection'
import { useUIStore } from '@/store/ui-store'

const mocks = vi.hoisted(() => ({
  usePreferences: vi.fn(),
  mutate: vi.fn(),
  useClaudeAccountAuth: vi.fn(),
}))

vi.mock('@/services/preferences', async importOriginal => ({
  ...(await importOriginal<typeof PreferencesService>()),
  usePreferences: () => mocks.usePreferences(),
  usePatchPreferences: () => ({ mutate: mocks.mutate }),
}))

vi.mock('@/services/claude-cli', async importOriginal => ({
  ...(await importOriginal<typeof ClaudeCliService>()),
  useClaudeCliStatus: () => ({
    data: {
      installed: true,
      path: '/bin/claude',
      supports_auth_command: true,
    },
  }),
  useClaudeAccountAuth: (id: string) => mocks.useClaudeAccountAuth(id),
}))

const work = { id: 'acc-work', label: 'Work', config_dir: '/u/.claude-work' }

describe('ClaudeAccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePreferences.mockReturnValue({
      data: {
        claude_root_label: 'Personal',
        claude_accounts: [work],
        claude_active_account: null,
      },
    })
    mocks.useClaudeAccountAuth.mockImplementation((id: string) => ({
      isLoading: false,
      data: { authenticated: id === 'root', error: null },
    }))
  })

  it('shows the root install with its label and every account with its status', () => {
    render(<ClaudeAccountsSection />)

    const root = screen.getByTestId('claude-account-root')
    expect(root).toHaveTextContent('~/.claude (root install)')
    expect(root).toHaveTextContent('Logged in')
    expect(root).toHaveTextContent('Active')
    expect(screen.getByDisplayValue('Personal')).toBeInTheDocument()

    const account = screen.getByTestId('claude-account-acc-work')
    expect(account).toHaveTextContent('/u/.claude-work')
    expect(account).toHaveTextContent('Not logged in')
    expect(account).toHaveTextContent('Make active')
    expect(
      screen.getByText(/MCP servers, plugins, skills and settings are separate/)
    ).toBeInTheDocument()
  })

  it('explains how to set up another account', () => {
    render(<ClaudeAccountsSection />)

    const steps = screen.getByTestId('claude-accounts-setup')
    expect(steps.querySelectorAll('li')).toHaveLength(5)
    expect(steps).toHaveTextContent('click Add account')
    expect(steps).toHaveTextContent('Click Login on the new row')
    expect(steps).toHaveTextContent('Click Make active')
    expect(steps).toHaveTextContent('A new folder starts empty')
  })

  it('labels the root install', async () => {
    const user = userEvent.setup()
    render(<ClaudeAccountsSection />)

    const input = screen.getByDisplayValue('Personal')
    await user.clear(input)
    await user.type(input, 'Home{Enter}')

    expect(mocks.mutate).toHaveBeenCalledWith(
      { claude_root_label: 'Home' },
      expect.anything()
    )
  })

  it('adds an account with a label and folder', async () => {
    const user = userEvent.setup()
    render(<ClaudeAccountsSection />)

    await user.type(screen.getByLabelText('New account label'), 'Client')
    await user.type(
      screen.getByLabelText('New account folder'),
      '~/.claude-client'
    )
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    const patch = mocks.mutate.mock.calls[0]?.[0]
    expect(patch.claude_accounts).toHaveLength(2)
    expect(patch.claude_accounts[1]).toMatchObject({
      label: 'Client',
      config_dir: '~/.claude-client',
    })
    expect(patch.claude_accounts[1].id).toMatch(/^acc-/)
  })

  it('makes an account active and removes one', async () => {
    const user = userEvent.setup()
    render(<ClaudeAccountsSection />)

    await user.click(screen.getByRole('button', { name: 'Make active' }))
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      { claude_active_account: 'acc-work' },
      expect.anything()
    )

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      { claude_accounts: [] },
      expect.anything()
    )
  })

  it('logs an account in with its config folder', async () => {
    const user = userEvent.setup()
    const openCliLoginModal = vi.fn()
    useUIStore.setState({ openCliLoginModal })
    render(<ClaudeAccountsSection />)

    const account = screen.getByTestId('claude-account-acc-work')
    await user.click(account.querySelector('button') as HTMLButtonElement)

    expect(openCliLoginModal).toHaveBeenCalledWith('claude', 'env', [
      'CLAUDE_CONFIG_DIR=/u/.claude-work',
      '/bin/claude',
      'auth',
      'login',
    ])
  })
})
