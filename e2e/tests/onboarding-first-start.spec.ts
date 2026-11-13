import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/tauri-mock'
import { mockPreferences } from '../fixtures/mock-data'

/**
 * First start of the desktop app: one dialog at a time. The setup dialog
 * walks forward step by step, logins run inside their step, the feature tour
 * follows, and the update prompt waits until the tour has ended.
 *
 * Set ONBOARDING_SHOTS=<dir> to save a screenshot of every step.
 */

interface FirstStartState {
  claude: boolean
  gh: boolean
  claudeAuth: boolean
  ghAuth: boolean
  terminals: string[]
  maxDialogs: number
  titles: string[]
}

declare global {
  interface Window {
    __FIRST_START__: FirstStartState
  }
}

const DESKTOP = { width: 1000, height: 600 }

/** The mock app is Web Access; a stub Tauri IPC makes it the released
 * desktop app (update check on). The CLI mocks are stateful: an install marks
 * the CLI installed, a login terminal that exits with 0 marks it logged in. */
async function firstStartDesktopApp(
  page: Page,
  options: { cliReady: boolean; ghReady?: boolean; updateVersion?: string }
) {
  await page.addInitScript(
    ({ cliReady, ghReady, updateVersion }) => {
      if (updateVersion) {
        ;(window as unknown as { __E2E_UPDATER__: unknown }).__E2E_UPDATER__ = {
          version: updateVersion,
          calls: [],
        }
      }
      let next = 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__TAURI_INTERNALS__ = {
        invoke: (cmd: string) => {
          if (cmd === 'plugin:app|identifier')
            return Promise.resolve('app.splitkick.desktop')
          if (cmd === 'plugin:app|version') return Promise.resolve('1.0.0')
          return Promise.resolve(null)
        },
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

      const state: FirstStartState = {
        claude: cliReady,
        gh: ghReady,
        claudeAuth: cliReady,
        ghAuth: ghReady,
        terminals: [],
        maxDialogs: 0,
        titles: [],
      }
      window.__FIRST_START__ = state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handlers = (window as any).__JEAN_E2E_MOCK__.invokeHandlers
      handlers.check_claude_cli_installed = () => ({
        installed: state.claude,
        version: state.claude ? '2.1.0' : null,
        path: state.claude ? '/opt/splitkick/claude' : null,
      })
      handlers.check_gh_cli_installed = () => ({
        installed: state.gh,
        version: state.gh ? '2.80.0' : null,
        path: state.gh ? '/opt/splitkick/gh' : null,
      })
      handlers.check_claude_cli_auth = () => ({
        authenticated: state.claudeAuth,
      })
      handlers.check_gh_cli_auth = () => ({ authenticated: state.ghAuth })
      handlers.install_claude_cli = () => {
        state.claude = true
        return null
      }
      handlers.install_gh_cli = () => {
        state.gh = true
        return null
      }
      handlers.get_available_cli_versions = () => [
        { version: '2.1.0', prerelease: false },
      ]
      handlers.get_available_gh_versions = () => [
        { version: '2.80.0', prerelease: false },
      ]
      handlers.start_terminal = (args?: Record<string, unknown>) => {
        state.terminals.push(String(args?.terminalId ?? args?.terminal_id))
        return null
      }

      // Count the dialogs that are open at the same time, all run long.
      setInterval(() => {
        const open = [
          ...document.querySelectorAll(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
          ),
        ]
        state.maxDialogs = Math.max(state.maxDialogs, open.length)
        for (const dialog of open) {
          const title = dialog.querySelector('h2')?.textContent?.trim() ?? '?'
          if (state.titles[state.titles.length - 1] !== title) {
            state.titles.push(title)
          }
        }
      }, 25)
    },
    {
      cliReady: options.cliReady,
      ghReady: options.ghReady ?? options.cliReady,
      updateVersion: options.updateVersion,
    }
  )
  await page.reload()
}

const firstStart = (page: Page) => page.evaluate(() => window.__FIRST_START__)

/** Let the login terminal exit with 0, as `claude login` / `gh auth login`. */
async function finishLogin(page: Page, key: 'claudeAuth' | 'ghAuth') {
  await expect
    .poll(async () => (await firstStart(page)).terminals.length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  await page.evaluate(authKey => {
    const state = window.__FIRST_START__
    state[authKey] = true
    const terminalId = state.terminals.pop()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__JEAN_E2E_MOCK__.eventEmitter.dispatchEvent(
      new CustomEvent('terminal:stopped', {
        detail: { terminal_id: terminalId, exit_code: 0, signal: null },
      })
    )
  }, key)
}

async function shot(page: Page, name: string) {
  const dir = process.env.ONBOARDING_SHOTS
  if (!dir) return
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  // Let open/close animations finish before the capture
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${name}-${stamp}.png` })
}

const onboarding = (page: Page) => page.getByRole('dialog').first()

/** The terminal and the Back footer fit inside the window. */
async function expectSetupFitsWindow(page: Page) {
  await expect(onboarding(page)).toBeInViewport({ ratio: 1 })
  await expect(
    onboarding(page).getByRole('button', { name: /^Back$/ })
  ).toBeInViewport({ ratio: 1 })
  await expect(
    onboarding(page).locator('[class*="min-h-[200px]"]').first()
  ).toBeInViewport({ ratio: 1 })
}

async function expectTourButtonsVisible(page: Page) {
  const tour = page.getByRole('dialog')
  for (const name of [/^Skip/, /^Back/, /^(Next|Done)/]) {
    await expect(tour.getByRole('button', { name })).toBeInViewport({
      ratio: 1,
    })
  }
}

test.use({
  viewport: DESKTOP,
  responseOverrides: {
    load_preferences: { ...mockPreferences, zoom_level: 100 },
  },
})

test.describe('First start', () => {
  test('setup walks forward in one dialog; the update prompt waits for the tour', async ({
    mockPage: page,
  }) => {
    test.setTimeout(60_000)
    await firstStartDesktopApp(page, {
      cliReady: false,
      updateVersion: '9.9.9',
    })

    // "Local or Remote" shows only while the remote server is on
    const local = page.getByRole('button', { name: /^Local/ })
    await expect(onboarding(page)).toBeVisible({ timeout: 15_000 })
    if (await local.isVisible()) {
      await shot(page, 'onboarding-0-usage-mode')
      await local.click()
      await page.getByRole('button', { name: /^Continue$/ }).click()
    }

    await expect(onboarding(page)).toContainText('AI Backend(s)')
    await shot(page, 'onboarding-1-backends')
    await page.getByText('Claude CLI', { exact: true }).click()
    await page.getByRole('button', { name: /^Continue/ }).click()

    await expect(
      page.getByRole('button', { name: /^Install with/ })
    ).toBeVisible()
    await shot(page, 'onboarding-2-claude-source')
    await page.getByRole('button', { name: /^Install with/ }).click()

    // The update check has run by now (5 s); its prompt must not cover setup.
    const install = page.getByRole('button', { name: /^Install Claude CLI/ })
    await expect(install).toBeVisible()
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as unknown as { __E2E_UPDATER__: { calls: string[] } })
              .__E2E_UPDATER__.calls
        )
      )
      .toContain('check')
    await expect(
      page.getByRole('dialog', { name: 'Update Available' })
    ).toHaveCount(0)
    await shot(page, 'onboarding-3-claude-version')
    await install.click()

    // Login runs in a terminal inside the same step
    await expect(onboarding(page)).toContainText('Claude CLI Login Required')
    await expectSetupFitsWindow(page)
    await shot(page, 'onboarding-4-claude-login')
    await finishLogin(page, 'claudeAuth')

    await expect(
      page.getByRole('button', { name: /^Install with/ })
    ).toBeVisible({ timeout: 10_000 })
    await expect(onboarding(page)).toContainText('GitHub CLI')
    await shot(page, 'onboarding-5-gh-source')
    await page.getByRole('button', { name: /^Install with/ }).click()
    await page.getByRole('button', { name: /^Install GitHub CLI/ }).click()
    await expect(onboarding(page)).toContainText('GitHub CLI Login Required')
    await expectSetupFitsWindow(page)
    await shot(page, 'onboarding-6-gh-login')
    await finishLogin(page, 'ghAuth')

    // The dialog ends on its own Done step; it does not vanish mid-flow
    const done = page.getByRole('dialog', { name: 'Setup Complete' })
    await expect(done).toBeVisible({ timeout: 10_000 })
    await shot(page, 'onboarding-7-complete')
    await done.getByRole('button', { name: /^Continue to/ }).click()

    // The tour follows as the next step
    const tour = page.getByRole('dialog', { name: 'Start with the Magic Menu' })
    await expect(tour).toBeVisible()
    await expect(tour).toContainText('Step 1 of 6')
    await expectTourButtonsVisible(page)
    await shot(page, 'tour-1')
    await tour.getByRole('button', { name: /^Next/ }).click()
    await expect(page.getByRole('dialog')).toContainText('Step 2 of 6')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Back/ })
      .click()
    await expect(page.getByRole('dialog')).toContainText('Step 1 of 6')
    for (let step = 2; step <= 6; step += 1) {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Next/ })
        .click()
      await expect(page.getByRole('dialog')).toContainText(`Step ${step} of 6`)
      await expectTourButtonsVisible(page)
    }
    await shot(page, 'tour-6-last')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Done/ })
      .click()

    // Only now the queued update prompt shows
    await expect(
      page.getByRole('dialog', { name: 'Update Available' })
    ).toBeVisible({ timeout: 10_000 })

    const { maxDialogs, titles } = await firstStart(page)
    expect(maxDialogs, `dialogs seen: ${titles.join(' → ')}`).toBe(1)
    expect(titles.indexOf('Update Available')).toBeGreaterThan(
      titles.indexOf('Setup Complete')
    )
  })

  for (const viewport of [
    { width: 1000, height: 600 },
    { width: 1000, height: 420 },
  ]) {
    test(`the tour fits ${viewport.width}×${viewport.height}: buttons stay visible, the list scrolls`, async ({
      mockPage: page,
    }) => {
      await page.setViewportSize(viewport)
      await firstStartDesktopApp(page, { cliReady: true })
      const tour = page.getByRole('dialog', {
        name: 'Start with the Magic Menu',
      })
      await expect(tour).toBeVisible({ timeout: 15_000 })
      await expect(tour).toBeInViewport({ ratio: 1 })
      await expectTourButtonsVisible(page)

      // The longest step (all AI backends) scrolls inside the dialog
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /^Next/ }).click()
      await dialog.getByRole('button', { name: /^Next/ }).click()
      await expect(dialog).toContainText('Step 3 of 6')
      await expectTourButtonsVisible(page)
      const body = page.getByTestId('feature-tour-body')
      const overflow = await body.evaluate(
        el => el.scrollHeight > el.clientHeight
      )
      expect(overflow).toBe(true)
      await body.evaluate(el => el.scrollTo(0, el.scrollHeight))
      await expect(body.locator(':scope > div').last()).toBeInViewport({
        ratio: 1,
      })
    })
  }

  test('the tour fits a phone in Web Access, without keyboard hints', async ({
    mockPage: page,
  }) => {
    await page.setViewportSize({ width: 390, height: 640 })
    // Web Access does not open the tour on its own; open it as the menu does
    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/store/ui-store.ts')
      useUIStore.getState().setFeatureTourOpen(true)
    })
    const tour = page.getByRole('dialog', { name: 'Start with the Magic Menu' })
    await expect(tour).toBeVisible()
    await expect(tour).toBeInViewport({ ratio: 1 })
    await expectTourButtonsVisible(page)
    await expect(tour.locator('kbd', { hasText: /^(S|↵)$/ })).toHaveCount(0)
  })

  test('GitHub CLI is optional: Skip goes to Done', async ({
    mockPage: page,
  }) => {
    test.setTimeout(60_000)
    await firstStartDesktopApp(page, { cliReady: false })

    const local = page.getByRole('button', { name: /^Local/ })
    await expect(onboarding(page)).toBeVisible({ timeout: 15_000 })
    if (await local.isVisible()) {
      await local.click()
      await page.getByRole('button', { name: /^Continue$/ }).click()
    }
    await page.getByText('Claude CLI', { exact: true }).click()
    await page.getByRole('button', { name: /^Continue/ }).click()
    await page.getByRole('button', { name: /^Install with/ }).click()
    await page.getByRole('button', { name: /^Install Claude CLI/ }).click()
    await finishLogin(page, 'claudeAuth')

    await expect(onboarding(page)).toContainText('GitHub CLI (optional)', {
      timeout: 10_000,
    })
    const skip = page.getByRole('button', { name: "Skip, I don't use GitHub" })
    await expect(skip).toBeVisible()
    await shot(page, 'gh-optional-1-skip')
    await skip.click()

    const done = page.getByRole('dialog', { name: 'Setup Complete' })
    await expect(done).toBeVisible()
    await expect(done).toContainText('GitHub CLI: not set up')
    await shot(page, 'gh-optional-2-done')
    expect((await firstStart(page)).gh).toBe(false)
  })

  test('an AI backend alone is ready: no setup dialog, no banner', async ({
    mockPage: page,
  }) => {
    await firstStartDesktopApp(page, { cliReady: true, ghReady: false })

    // Setup is complete, so the first-start tour opens instead of setup
    const tour = page.getByRole('dialog', { name: 'Start with the Magic Menu' })
    await expect(tour).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Setup incomplete/)).toHaveCount(0)
    const { titles } = await firstStart(page)
    expect(titles).not.toContain('Setup GitHub CLI')
  })

  test('a GitHub feature without gh shows "GitHub CLI is not set up"', async ({
    mockPage: page,
  }) => {
    await firstStartDesktopApp(page, { cliReady: true, ghReady: false })
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handlers = (window as any).__JEAN_E2E_MOCK__.invokeHandlers
      handlers.list_workflow_runs = () => {
        throw 'Failed to run gh run list: No such file or directory (os error 2)'
      }
    })
    const tour = page.getByRole('dialog', { name: 'Start with the Magic Menu' })
    await expect(tour).toBeVisible({ timeout: 15_000 })
    await tour.getByRole('button', { name: /^Skip/ }).click()
    await expect(tour).toHaveCount(0)

    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/store/ui-store.ts')
      useUIStore.setState({
        workflowRunsModalOpen: true,
        workflowRunsModalProjectPath: '/tmp/e2e-repo',
        workflowRunsModalBranch: null,
      })
    })
    const runs = page.getByRole('dialog')
    await expect(runs).toContainText('GitHub CLI is not set up', {
      timeout: 10_000,
    })
    await expect(runs).not.toContainText('os error')
    await shot(page, 'gh-optional-3-not-set-up')

    await runs.getByRole('button', { name: 'Set up GitHub CLI' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Setup GitHub CLI' })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: "Skip, I don't use GitHub" })
    ).toBeVisible()
  })
})
