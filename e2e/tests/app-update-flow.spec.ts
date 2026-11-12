import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/tauri-mock'

/**
 * The desktop app's update flow, with the updater stub
 * (`e2e/stubs/tauri-plugin-updater.ts`). From 1.5.9 to 1.5.14 the only
 * Restart button sat in a toast that could not be seen, so no update was
 * applied (#135). The restart must be offered by the "Update Ready" prompt
 * and the toolbar, never only by a toast.
 */
const VERSION = '9.9.9'

interface UpdaterState {
  version: string
  calls: string[]
}

/** The mock app is Web Access; a stub Tauri IPC makes it the released
 * desktop app, so the update check runs. Calls the app sends through its
 * transport still go to the e2e mock; the ones the update flow sends are
 * recorded next to the updater's own calls. */
async function asReleasedDesktopApp(page: Page) {
  await page.addInitScript(version => {
    const state = { version, calls: [] as string[] }
    ;(window as unknown as { __E2E_UPDATER__: UpdaterState }).__E2E_UPDATER__ =
      state
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
    // Added after the fixture's script, so its handlers exist.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (window as any).__JEAN_E2E_MOCK__.invokeHandlers
    for (const cmd of [
      'relaunch_app',
      'send_native_notification',
      'set_tray_update_ready',
    ]) {
      handlers[cmd] = (args?: Record<string, unknown>) => {
        state.calls.push(`${cmd} ${JSON.stringify(args ?? null)}`)
        return null
      }
    }
  }, VERSION)
  await page.reload()
  await skipOnboarding(page)
}

async function skipOnboarding(page: Page) {
  const skip = page.getByRole('button', { name: /^Skip/ })
  const shown = await skip
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (shown) await skip.click()
}

const calls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __E2E_UPDATER__: UpdaterState }).__E2E_UPDATER__
        .calls
  )

/** The auto check runs 5 s after start and offers the update. */
async function expectOffer(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Update Available' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).toContainText(`Version ${VERSION}`)
  return dialog
}

async function downloadToReady(page: Page) {
  const offer = await expectOffer(page)
  await offer.getByRole('button', { name: 'Update Now' }).click()
  // Progress shows while the package downloads.
  await expect(
    page.locator('[data-sonner-toast]', { hasText: /Downloading update/ })
  ).toBeInViewport()
  const ready = page.getByRole('dialog', { name: 'Update Ready' })
  await expect(ready).toBeInViewport({ timeout: 10_000 })
  await expect(ready).toContainText(`Version ${VERSION} is installed`)
  return ready
}

test.describe('App update flow (#135)', () => {
  test('check → download → "Update Ready" → Restart installs and relaunches', async ({
    mockPage,
  }) => {
    await asReleasedDesktopApp(mockPage)
    const ready = await downloadToReady(mockPage)

    // The progress toast does not stay behind as the only "ready" signal.
    await expect(
      mockPage.locator('[data-sonner-toast]', { hasText: /Downloading/ })
    ).toHaveCount(0)

    await ready.getByRole('button', { name: 'Restart Now' }).click()

    await expect.poll(() => calls(mockPage)).toContain('relaunch_app null')
    const sequence = await calls(mockPage)
    expect(sequence.indexOf('install')).toBeGreaterThan(
      sequence.indexOf('download')
    )
    expect(sequence.indexOf('relaunch_app null')).toBeGreaterThan(
      sequence.indexOf('install')
    )
    expect(sequence).toContain(
      `set_tray_update_ready ${JSON.stringify({ version: VERSION })}`
    )
    expect(
      sequence.filter(call => call.startsWith('send_native_notification'))
    ).toHaveLength(1)
  })

  test('"Later" keeps a restart in the toolbar, also with the sidebar hidden', async ({
    mockPage,
  }) => {
    await asReleasedDesktopApp(mockPage)
    const ready = await downloadToReady(mockPage)
    await ready.getByRole('button', { name: 'Later' }).click()
    await expect(ready).toHaveCount(0)

    const toolbar = mockPage.getByTestId('window-toolbar')
    const restart = toolbar.getByTestId('app-update-indicator')
    await expect(restart).toBeInViewport()
    await expect(restart).toHaveText('Restart to update')

    // Hide the sidebar (its footer holds the other Updates button).
    const hide = mockPage.getByRole('button', { name: 'Hide sidebar' })
    if (await hide.isVisible().catch(() => false)) await hide.click()
    await expect(mockPage.getByTestId('sidebar-updates')).toBeHidden()
    await expect(restart).toBeInViewport()

    await restart.click()
    await expect.poll(() => calls(mockPage)).toContain('relaunch_app null')
    expect(await calls(mockPage)).toContain('install')
  })

  test('a downloaded update that was not installed is offered at the next start', async ({
    mockPage,
  }) => {
    await asReleasedDesktopApp(mockPage)
    const ready = await downloadToReady(mockPage)
    await ready.getByRole('button', { name: 'Later' }).click()

    // Quit without a restart: the package was never installed.
    await mockPage.reload()
    await skipOnboarding(mockPage)

    const offer = await expectOffer(mockPage)
    // Offered before any new download; the new start cleared the stale
    // "Restart to update" tray entry (the package was in the old process).
    expect(await calls(mockPage)).toEqual([
      'set_tray_update_ready {"version":null}',
      'check',
    ])
    await offer.getByRole('button', { name: 'Update Now' }).click()
    await expect(
      mockPage.getByRole('dialog', { name: 'Update Ready' })
    ).toBeInViewport({ timeout: 10_000 })
    // One notification per version, also across starts.
    expect(
      (await calls(mockPage)).filter(call =>
        call.startsWith('send_native_notification')
      )
    ).toHaveLength(0)
  })
})
