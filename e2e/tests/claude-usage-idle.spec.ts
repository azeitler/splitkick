import { test, expect } from '../fixtures/tauri-mock'
import { mockPreferences } from '../fixtures/mock-data'

// Accounts that are not active get no `claude` run, so their token expires
// (#131). They show their last stored usage with its age, or a note.
const captureDir = process.env.CAPTURE_DIR
const now = () => Math.floor(Date.now() / 1000)

test.use({
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
  responseOverrides: {
    load_preferences: {
      ...mockPreferences,
      zoom_level: 100,
      claude_root_label: 'Personal',
      claude_accounts: [
        { id: 'acc-work', label: 'Work', config_dir: '~/.claude-work' },
        { id: 'acc-lab', label: 'Lab', config_dir: '~/.claude-lab' },
      ],
      claude_active_account: 'acc-work',
    },
    check_claude_cli_installed: {
      installed: true,
      version: '2.1.277',
      path: '/usr/local/bin/claude',
      supports_auth_command: true,
    },
    check_claude_cli_auth: { authenticated: true, error: null },
    get_claude_usage: {
      __byAccountId: {
        root: {
          planType: 'max',
          accountEmail: 'me@example.com',
          session: null,
          weekly: { usedPercent: 64, resetsAt: now() + 2 * 86_400 },
          sonnetWeekly: null,
          limits: [],
          extraUsageSpent: null,
          extraUsageLimit: null,
          fetchedAt: now() - 9 * 3600,
        },
        'acc-work': {
          planType: 'max',
          accountEmail: 'me@work.example',
          session: { usedPercent: 12, resetsAt: now() + 3600 },
          weekly: { usedPercent: 30, resetsAt: now() + 3 * 86_400 },
          sonnetWeekly: null,
          limits: [],
          extraUsageSpent: null,
          extraUsageLimit: null,
          fetchedAt: now() - 60,
        },
        'acc-lab': {
          __error:
            'Not used recently. Usage shows after the next run with this account.',
        },
      },
    },
  },
})

test('idle accounts show their stored usage with its age, or a note', async ({
  mockPage,
}) => {
  await expect(mockPage.getByText('Test Project')).toBeVisible({
    timeout: 60_000,
  })
  await mockPage.getByTestId('toggle-left-sidebar').first().click()
  await mockPage.getByTestId('titlebar-usage').click()

  const personal = mockPage.getByTestId('claude-usage-account-root')
  await expect(personal.getByText(/as of 9h ago \(/)).toBeVisible()
  const work = mockPage.getByTestId('claude-usage-account-acc-work')
  await expect(work.getByText(/as of/)).toHaveCount(0)
  const lab = mockPage.getByTestId('claude-usage-account-acc-lab')
  await expect(lab.getByText(/^Not used recently/)).toBeVisible()
  await expect(lab.getByRole('button', { name: /Retry/i })).toHaveCount(0)

  if (captureDir) {
    await mockPage.waitForTimeout(300)
    await mockPage
      .locator('[data-slot="popover-content"]')
      .screenshot({ path: `${captureDir}/usage-idle-accounts.png` })
  }
})
