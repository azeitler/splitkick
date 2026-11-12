import { test, expect } from '../fixtures/tauri-mock'
import type { Locator, Page } from '@playwright/test'

// Browser for agents (#104). Set CAPTURE_DIR to save screenshots of each state.

const status = (overrides: Record<string, unknown> = {}) => ({
  engine: 'agent_browser',
  hasToken: false,
  managedInstall: false,
  managedVersion: null,
  nodePath: '/opt/homebrew/bin/node',
  extensionUrl:
    'https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm',
  installedBackends: ['claude', 'codex'],
  handMade: [],
  ...overrides,
})

const agentBrowserStatus = {
  installed: true,
  binaryPath:
    '/opt/splitkick/agent-browser-cli/node_modules/.bin/agent-browser',
  version: '0.9.1',
  profilePath: '/opt/splitkick/agent-browser/profile',
  profileExists: true,
  managedDir: '/opt/splitkick/agent-browser-cli',
  managedInstall: true,
  claudeSnippet: '{}',
  codexSnippet: '',
  installHint: '',
}

/** The mock app is Web Access; a stub Tauri IPC makes it the desktop app
 * (`isLocalBackend()`). Calls still go to the e2e mock handlers. */
async function asDesktopApp(page: Page) {
  await page.addInitScript(() => {
    let next = 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: () => Promise.resolve(null),
      transformCallback: () => next++,
      unregisterCallback: () => undefined,
      convertFileSrc: (src: string) => src,
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => undefined,
    }
  })
  await page.reload()
  // The desktop app greets with the onboarding tour; close it.
  const skip = page.getByRole('button', { name: /^Skip/ })
  const shown = await skip
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (shown) await skip.click()
}

async function openSection(page: Page, desktop = true) {
  if (desktop) await asDesktopApp(page)
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 5000 })
  // Cmd+, and Cmd+B are native menu accelerators in the desktop app; click.
  const footer = page.getByTestId('sidebar-footer')
  if (!(await footer.isVisible())) {
    await page.getByRole('button', { name: 'Show sidebar' }).click()
  }
  await footer.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 3000 })
  await dialog.getByRole('button', { name: 'Web Browser' }).click()
  const section = dialog.locator('#pref-mcp-section-agent-browser')
  await expect(section.getByText('Browser for agents')).toBeVisible()
  await section.scrollIntoViewIfNeeded()
  return section
}

async function capture(target: Locator, name: string) {
  const dir = process.env.CAPTURE_DIR
  if (!dir) return
  await target.screenshot({ path: `${dir}/${name}.png` })
}

test.describe('Browser for agents', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 1000 } })
  test.describe('Agent Browser', () => {
    test.use({
      responseOverrides: {
        get_browser_engine_status: status(),
        get_agent_browser_status: agentBrowserStatus,
      },
    })
    test('shows the engines with Agent Browser chosen', async ({
      mockPage,
    }) => {
      const section = await openSection(mockPage)
      await expect(
        section.getByRole('radio', { name: 'Agent Browser' })
      ).toBeChecked()
      await expect(
        section.getByText(/agent-browser 0\.9\.1 installed/)
      ).toBeVisible()
      await capture(section, 'browser-engine-agent-browser')

      // Claude in Chrome shares the Web Browser pane and is off by default.
      const chrome = mockPage.locator('#pref-web-browser-section-claude-chrome')
      await expect(
        chrome.getByRole('switch', { name: 'Chrome browser integration' })
      ).not.toBeChecked()
      await expect(chrome.getByTestId('claude-chrome-hint')).toBeVisible()
      await capture(
        mockPage.locator('#pref-pane-web-browser'),
        'web-browser-pane'
      )
    })
  })

  test.describe('Playwright', () => {
    test.use({
      responseOverrides: {
        get_browser_engine_status: status({ engine: 'playwright' }),
        test_browser_connection: '### Open tabs\n- 0: (current) [about:blank]',
      },
    })
    test('own browser: test connection', async ({ mockPage }) => {
      const section = await openSection(mockPage)
      await expect(
        section.getByRole('radio', { name: 'Playwright', exact: true })
      ).toBeChecked()
      await section.getByRole('button', { name: 'Test connection' }).click()
      await expect(section.getByText(/Connected\./)).toBeVisible()
      await capture(section, 'browser-engine-playwright')
    })

    test('asks before using the real Chrome', async ({ mockPage }) => {
      const section = await openSection(mockPage)
      await section
        .getByRole('radio', { name: 'Playwright with your Chrome' })
        .click()
      const confirm = mockPage.getByRole('alertdialog')
      await expect(
        confirm.getByText('Let agents use your Chrome?')
      ).toBeVisible()
      await capture(
        mockPage.getByRole('dialog').first(),
        'browser-engine-confirm'
      )
      await confirm.getByRole('button', { name: 'Cancel' }).click()
    })
  })

  test.describe('Playwright with your Chrome', () => {
    test.use({
      responseOverrides: {
        get_browser_engine_status: status({
          engine: 'playwright_extension',
          hasToken: true,
        }),
      },
    })
    test('warning, token field and extension link', async ({ mockPage }) => {
      const section = await openSection(mockPage)
      await expect(
        section.getByText('Agents act in your real browser')
      ).toBeVisible()
      await expect(section.getByLabel('Connection token')).toHaveAttribute(
        'type',
        'password'
      )
      await expect(
        section.getByRole('button', { name: /Get the Playwright extension/ })
      ).toBeVisible()
      await expect(section.getByText('A token is saved.')).toBeVisible()
      await capture(section, 'browser-engine-extension')
    })
  })

  test.describe('Web Access', () => {
    test.use({
      responseOverrides: {
        get_browser_engine_status: status({
          engine: 'playwright_extension',
          hasToken: true,
        }),
      },
    })
    test('shows the setting read-only, no token field', async ({
      mockPage,
    }) => {
      const section = await openSection(mockPage, false)
      await expect(section.getByText(/Read-only here/)).toBeVisible()
      await expect(
        section.getByRole('radio', { name: 'Playwright with your Chrome' })
      ).toBeDisabled()
      await expect(section.getByLabel('Connection token')).toHaveCount(0)
      await expect(section.getByText('A token is saved.')).toBeVisible()
      await capture(section, 'browser-engine-web-access')
    })
  })

  test.describe('Hand-made Playwright', () => {
    test.use({
      responseOverrides: {
        get_browser_engine_status: status({
          engine: 'playwright',
          handMade: [
            {
              backend: 'claude',
              serverName: 'playwright',
              path: '~/.claude.json',
            },
          ],
        }),
      },
    })
    test('offers to take it over', async ({ mockPage }) => {
      const section = await openSection(mockPage)
      await expect(
        section.getByText('You already set up Playwright yourself')
      ).toBeVisible()
      await expect(
        section.getByRole('button', { name: 'Take over' })
      ).toBeVisible()
      await capture(section, 'browser-engine-take-over')
    })
  })
})
