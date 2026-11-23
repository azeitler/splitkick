import { test, expect } from '../fixtures/tauri-mock'
import { mockPreferences } from '../fixtures/mock-data'
import type { Locator, Page } from '@playwright/test'

// Settings → Web Access: Instance Name and "Add to 1Password". Set
// CAPTURE_DIR (and optionally CAPTURE_STAMP) to save a screenshot.

const responseOverrides = {
  load_preferences: { ...mockPreferences, session_backup_device_name: null },
  get_default_device_name: 'Mac 1',
  get_onepassword_status: { installed: true },
  get_http_server_status: {
    running: true,
    port: 3456,
    url: 'http://192.168.1.20:3456',
    token: 'sample-token-0000',
    bind_host: '192.168.1.20',
    localhost_only: false,
  },
  list_http_bind_host_options: [],
  get_tailscale_info: {
    installed: true,
    running: true,
    tailnetName: 'tail1234.ts.net',
    magicDnsEnabled: true,
    dnsName: 'box.tail1234.ts.net',
    ips: ['100.64.0.1'],
    serves: [
      {
        url: 'https://box.tail1234.ts.net',
        proxyTarget: 'http://127.0.0.1:3456',
        servesSplitkick: true,
        funnel: false,
      },
    ],
    port: 3456,
  },
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
  const skip = page.getByRole('button', { name: /^Skip/ })
  const shown = await skip
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (shown) await skip.click()
}

async function openWebAccess(page: Page, desktop: boolean): Promise<Locator> {
  if (desktop) await asDesktopApp(page)
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 5000 })
  const footer = page.getByTestId('sidebar-footer')
  if (!(await footer.isVisible())) {
    await page.getByRole('button', { name: 'Show sidebar' }).click()
  }
  await footer.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 3000 })
  await dialog.getByRole('button', { name: 'Web Access' }).click()
  await expect(
    dialog.getByText('Enable HTTP server', { exact: true })
  ).toBeVisible()
  return dialog
}

test.describe('Web Access: Instance Name and 1Password', () => {
  test.use({
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 1100 },
    responseOverrides,
  })

  test('the desktop app shows the Instance Name and Add to 1Password', async ({
    mockPage,
  }) => {
    const dialog = await openWebAccess(mockPage, true)
    const name = dialog.getByRole('textbox', { name: 'Instance Name' })
    await expect(name).toHaveAttribute('placeholder', 'Mac 1')
    await expect(
      dialog.getByRole('button', { name: /Add to 1Password/ })
    ).toBeVisible()

    const dir = process.env.CAPTURE_DIR
    if (dir) {
      const stamp = process.env.CAPTURE_STAMP ?? String(Date.now())
      await dialog.screenshot({
        path: `${dir}/web-access-1password-${stamp}.png`,
      })
    }
  })

  test('Web Access never offers Add to 1Password', async ({ mockPage }) => {
    const dialog = await openWebAccess(mockPage, false)
    await expect(
      dialog.getByRole('textbox', { name: 'Instance Name' })
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /Add to 1Password/ })
    ).toHaveCount(0)
  })
})
