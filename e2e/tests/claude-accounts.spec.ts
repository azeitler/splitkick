import { test, expect, MOD } from '../fixtures/tauri-mock'
import { mockPreferences } from '../fixtures/mock-data'

// Several Claude accounts (#90). Set CAPTURE_DIR to also save the screenshots
// used in the docs and on the issue.
const captureDir = process.env.CAPTURE_DIR

const now = () => Math.floor(Date.now() / 1000)
const usage = (email: string, session: number, weekly: number) => ({
  planType: 'max',
  accountEmail: email,
  session: { usedPercent: session, resetsAt: now() + 2 * 3600 },
  weekly: { usedPercent: weekly, resetsAt: now() + 3 * 86_400 },
  sonnetWeekly: { usedPercent: 4, resetsAt: now() + 3 * 86_400 },
  extraUsageSpent: null,
  extraUsageLimit: null,
  fetchedAt: now() - 60,
})

test.use({
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
  responseOverrides: {
    load_preferences: {
      ...mockPreferences,
      // The shared mock's 1.0 shrinks rem text; the app's normal zoom is 100.
      zoom_level: 100,
      claude_root_label: 'Personal',
      claude_accounts: [
        { id: 'acc-work', label: 'Work', config_dir: '~/.claude-work' },
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
    // A second signed-in backend, for the "+1" on the usage badge.
    check_codex_cli_installed: {
      installed: true,
      version: '1.0.0',
      path: '/c',
    },
    check_codex_cli_auth: { authenticated: true, error: null },
    get_claude_usage: {
      __byAccountId: {
        root: usage('me@example.com', 18, 42),
        'acc-work': usage('me@work.example', 63, 71),
      },
    },
  },
})

test('settings list the labelled root install and a second account', async ({
  mockPage,
}) => {
  await expect(mockPage.getByText('Test Project')).toBeVisible({
    timeout: 60_000,
  })
  await mockPage.keyboard.press(`${MOD}+,`)
  const dialog = mockPage.getByRole('dialog')
  await dialog
    .getByRole('button', { name: 'Claude Claude', exact: true })
    .click()

  const section = dialog.locator('#pref-claude-section-accounts')
  await expect(section).toBeVisible()
  await expect(section.getByLabel('Label for the root install')).toHaveValue(
    'Personal'
  )
  await expect(section.getByLabel('Label for Work')).toHaveValue('Work')
  await expect(
    section.getByTestId('claude-account-acc-work').getByText('~/.claude-work')
  ).toBeVisible()
  await expect(
    section.getByTestId('claude-account-acc-work').getByText('Active')
  ).toBeVisible()

  if (captureDir) {
    await section.scrollIntoViewIfNeeded()
    await section.screenshot({ path: `${captureDir}/accounts-settings.png` })
  }
})

test('usage shows the limits of both accounts', async ({ mockPage }) => {
  await expect(mockPage.getByText('Test Project')).toBeVisible({
    timeout: 60_000,
  })
  await mockPage.keyboard.press(`${MOD}+,`)
  const dialog = mockPage.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Usage', exact: true }).click()

  const claude = dialog.locator('#pref-usage-section-claude')
  await expect(claude.getByText('me@example.com')).toBeVisible()
  await expect(claude.getByText('me@work.example')).toBeVisible()
  await expect(claude.getByText('63.0%')).toBeVisible()

  if (captureDir) {
    await claude.screenshot({ path: `${captureDir}/accounts-usage.png` })
  }
})

test('the usage popover shows each account as a card', async ({ mockPage }) => {
  await expect(mockPage.getByText('Test Project')).toBeVisible({
    timeout: 60_000,
  })
  await mockPage.getByTestId('toggle-left-sidebar').first().click()
  await mockPage.getByTestId('titlebar-usage').click()

  const work = mockPage.getByTestId('claude-usage-account-acc-work')
  const root = mockPage.getByTestId('claude-usage-account-root')
  await expect(work.getByText('Active', { exact: true })).toBeVisible()
  await expect(root.getByRole('button', { name: 'Make active' })).toBeVisible()
  await expect(work.getByText(/^Resets in 2h \(/).first()).toBeVisible()

  if (captureDir) {
    await mockPage.waitForTimeout(300)
    await mockPage
      .locator('[data-slot="popover-content"]')
      .screenshot({ path: `${captureDir}/usage-popover.png` })
  }

  // Dev builds load usage only while the popover is open; it stays cached.
  await mockPage.keyboard.press('Escape')
  const badge = mockPage.getByTestId('titlebar-usage')
  await expect(badge).toHaveText(/71%/)
  await expect(mockPage.getByTestId('titlebar-usage-more')).toHaveText('+1')
  if (captureDir) {
    await mockPage
      .getByTestId('titlebar-usage')
      .locator('../..')
      .screenshot({ path: `${captureDir}/usage-badge-sidebar.png` })
  }
})
