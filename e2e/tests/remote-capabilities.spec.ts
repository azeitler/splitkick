import type { Page } from '@playwright/test'
import {
  test,
  expect,
  ensureSidebarOpen,
  sidebar,
} from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Web Access: Finder/terminal actions run on the backend host, so they are
 * enabled only when the browser sits at that host, else disabled with
 * "Host only" (#89). The mock app is Web Access on
 * `localhost`. Set REMOTE_WEB_URL (a non-loopback URL that serves the same
 * e2e dev server) to also check a browser on another machine.
 */

const project = createProject({ name: 'demo-app' })
const worktree = createWorktree(project.id, {
  name: 'feature-login',
  sessions: [createSession({ name: 'Login form' })],
})

test.use({
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    load_ui_state: { ...mockUIState, active_project_id: null },
  },
})

/** What `/api/init` reports for the desktop app hosting Web Access. */
async function hostAllowsNativeOpen(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const env = await import(/* @vite-ignore */ '/src/lib/environment.ts')
    env.setNativeOpenAllowed(true)
  })
}

async function openProjectMenu(page: Page) {
  await ensureSidebarOpen(page)
  const panel = sidebar(page)
  await panel.getByText('demo-app', { exact: true }).click()
  await panel.getByText('demo-app', { exact: true }).click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Copy Link' })).toBeVisible()
  return menu
}

async function shot(page: Page, name: string) {
  const dir = process.env.REMOTE_CAPS_SCREENSHOT_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` })
}

test.describe('Remote capabilities (#89)', () => {
  const hostItems = [
    /Open in (Finder|Explorer|Files)/,
    /Open in .*Terminal/,
    /Open Worktrees Folder/,
  ]

  test('Web Access on the host itself keeps Open in Finder enabled', async ({
    mockPage,
  }) => {
    await hostAllowsNativeOpen(mockPage)
    const menu = await openProjectMenu(mockPage)

    for (const name of hostItems) {
      const item = menu.getByRole('menuitem', { name })
      await expect(item).toBeVisible()
      await expect(item).not.toHaveAttribute('aria-disabled', 'true')
    }
    await expect(menu.getByText('Host only')).toHaveCount(0)
    await shot(mockPage, 'web-access-localhost')
  })

  test('Web Access from another machine disables Open in Finder', async ({
    mockPage,
  }) => {
    const remoteUrl = process.env.REMOTE_WEB_URL
    test.skip(!remoteUrl, 'set REMOTE_WEB_URL to a non-loopback URL')
    await mockPage.goto(remoteUrl as string)
    await mockPage.waitForLoadState('networkidle')
    await hostAllowsNativeOpen(mockPage)
    const menu = await openProjectMenu(mockPage)

    for (const name of hostItems) {
      const item = menu.getByRole('menuitem', { name })
      await expect(item).toBeVisible()
      await expect(item).toHaveAttribute('aria-disabled', 'true')
      await expect(item).toContainText('Host only')
    }
    await shot(mockPage, 'web-access-remote')
  })
})
