import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Vertical navigation (Settings → Experimental). Off: today's sidebar with
 * the tab strip. On (desktop app only): Home and the tabs in a nav left of
 * the panel, the sidebar toggle in the main toolbar, and on Home no panel and
 * two footers. Sample data only.
 */

const projects = ['Acme Web', 'Docs site', 'Mobile app'].map((name, i) =>
  createProject({ name, path: `/tmp/e2e-vnav/project-${i + 1}`, order: i })
)
const now = Date.now() / 1000
const worktrees = projects.map((project, i) =>
  createWorktree(project.id, {
    name: ['fuzzy-tiger', 'calm-dolphin', 'brave-otter'][i],
    path: `/tmp/e2e-vnav/project-${i + 1}/.worktrees/w${i + 1}`,
    sessions: [
      createSession({
        name: ['Fix login redirect', 'Weekly report', 'API design notes'][i],
        last_message_at: now - 60,
        // Two sessions on the To-Do list.
        ...(i < 2 && { todo_at: now - 120 }),
      }),
    ],
  })
)
const entries = projects.map((project, i) => ({
  project_id: project.id,
  project_name: project.name,
  worktree_id: worktrees[i].id,
  worktree_name: worktrees[i].name,
  worktree_path: worktrees[i].path,
  sessions: worktrees[i].sessions,
}))

const shotDir = process.env.VERTICAL_NAV_SCREENSHOT_DIR
const shotStamp = process.env.VERTICAL_NAV_SCREENSHOT_STAMP ?? 'shot'

async function shot(page: Page, name: string) {
  if (shotDir) {
    await page.screenshot({ path: `${shotDir}/${name}-${shotStamp}.png` })
  }
}

/** The mock app is Web Access; a stub Tauri IPC makes it the desktop app.
 *  Calls still go to the e2e mock handlers. */
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

const toolbar = (page: Page) => page.getByTestId('window-toolbar')
const navItem = (page: Page, id: string): Locator =>
  page.getByTestId(`vertical-nav-${id}`).first()

function withData(verticalNavigation: boolean, openProject: boolean) {
  test.use({
    viewport: { width: 1280, height: 720 },
    responseOverrides: {
      list_projects: projects,
      list_worktrees: worktrees,
      list_all_sessions: { entries },
      load_preferences: {
        ...mockPreferences,
        zoom_level: 100,
        has_seen_feature_tour: true,
        vertical_navigation: verticalNavigation,
      },
      load_ui_state: {
        ...mockUIState,
        active_project_id: openProject ? projects[0].id : null,
        expanded_project_ids: [projects[0].id],
        left_sidebar_visible: true,
        starred_sessions: entries.map(entry => ({
          project_id: entry.project_id,
          worktree_id: entry.worktree_id,
          session_id: entry.sessions[0].id,
        })),
      },
    },
  })
}

test.describe('Vertical navigation off', () => {
  withData(false, true)

  test('keeps the sidebar with the tab strip', async ({ mockPage }) => {
    await asDesktopApp(mockPage)
    await expect(mockPage.getByTestId('sidebar-tabs')).toBeVisible()
    await expect(mockPage.getByTestId('sidebar-home-row')).toBeVisible()
    await expect(mockPage.getByTestId('sidebar-header')).toBeVisible()
    await expect(mockPage.getByTestId('vertical-nav')).toHaveCount(0)
    await expect(mockPage.getByTestId('vertical-nav-layout')).toHaveCount(0)
    await shot(mockPage, 'vertical-nav-off')
  })
})

test.describe('Vertical navigation on, a project open', () => {
  withData(true, true)

  test('shows nav and panel, no tab strip, the sidebar button in the toolbar', async ({
    mockPage,
  }) => {
    await asDesktopApp(mockPage)
    const column = mockPage.getByTestId('sidebar-column')
    await expect(column.getByTestId('vertical-nav')).toBeVisible()
    await expect(column.getByTestId('projects-sidebar')).toBeVisible()
    await expect(
      column.getByTestId('projects-sidebar').getByText('Acme Web')
    ).toBeVisible()
    await expect(mockPage.getByTestId('sidebar-tabs')).toHaveCount(0)
    await expect(mockPage.getByTestId('sidebar-home-row')).toHaveCount(0)
    await expect(mockPage.getByTestId('sidebar-header')).toHaveCount(0)
    await expect(column.getByTestId('sidebar-footer')).toBeVisible()
    await expect(navItem(mockPage, 'projects')).toHaveAttribute(
      'aria-current',
      'page'
    )

    const toggle = toolbar(mockPage).getByTestId('toggle-left-sidebar')
    await expect(toggle).toHaveAccessibleName('Hide sidebar')
    await toggle.hover()
    await expect(mockPage.getByRole('tooltip')).toContainText('Hide Sidebar')
    await shot(mockPage, 'vertical-nav-projects')

    // Expanded: counts at the end of the row.
    await expect(mockPage.getByTestId('vertical-nav-count-starred')).toHaveText(
      '3'
    )
    await expect(mockPage.getByTestId('vertical-nav-count-todo')).toHaveText(
      '2'
    )

    // Collapsed: icons and badges, To-Do blue.
    await navItem(mockPage, 'collapse').click()
    await expect(mockPage.getByTestId('vertical-nav')).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    await expect(mockPage.getByTestId('vertical-nav-badge-starred')).toHaveText(
      '3'
    )
    const todoBadge = mockPage.getByTestId('vertical-nav-badge-todo')
    await expect(todoBadge).toHaveText('2')
    await expect(todoBadge).toHaveClass(/bg-blue-600/)
    await expect(navItem(mockPage, 'todo')).toHaveAccessibleName(
      'To-Do, 2 waiting for you'
    )
    await shot(mockPage, 'vertical-nav-collapsed')

    // Hide: nav, panel and footer go away; the toggle stays in the toolbar.
    await toggle.click()
    await expect(mockPage.getByTestId('sidebar-column')).toHaveCount(0)
    await expect(mockPage.getByTestId('vertical-nav')).toHaveCount(0)
    await expect(mockPage.getByTestId('sidebar-footer')).toHaveCount(0)
    await expect(toggle).toHaveAccessibleName('Show sidebar')
  })

  test('opens Home without panel, with the compact footer and the Home footer', async ({
    mockPage,
  }) => {
    await asDesktopApp(mockPage)
    await navItem(mockPage, 'home').click()

    const layout = mockPage.getByTestId('vertical-nav-layout')
    await expect(layout).toHaveAttribute('data-home', 'true')
    await expect(navItem(mockPage, 'home')).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(mockPage.getByTestId('sidebar-column')).toHaveCount(0)
    await expect(mockPage.getByTestId('projects-sidebar')).toHaveCount(0)
    await expect(
      toolbar(mockPage).getByTestId('toggle-left-sidebar')
    ).toHaveCount(0)

    const row = mockPage.getByTestId('home-footer-row')
    await expect(row.getByTestId('sidebar-footer')).toBeVisible()
    await expect(row.getByTestId('home-footer')).toBeVisible()
    await expect(mockPage.getByTestId('home-footer-projects')).toHaveText(
      '3projects'
    )
    await expect(mockPage.getByTestId('home-footer-today')).toContainText('3')
    // The sidebar footer keeps only the width of its icons.
    const footerBox = await row.getByTestId('sidebar-footer').boundingBox()
    expect(footerBox?.width ?? 0).toBeLessThan(260)
    await shot(mockPage, 'vertical-nav-home')

    // A tab brings the panel back.
    await navItem(mockPage, 'starred').click()
    await expect(layout).toHaveAttribute('data-home', 'false')
    await expect(
      mockPage.getByTestId('sidebar-column').getByTestId('projects-sidebar')
    ).toBeVisible()
    await expect(mockPage.getByTestId('home-footer')).toHaveCount(0)
  })
})

test.describe('Vertical navigation on, web access', () => {
  withData(true, true)

  test('keeps the sidebar with the tab strip', async ({ mockPage }) => {
    await expect(mockPage.getByText('Acme Web').first()).toBeVisible()
    if (!(await mockPage.getByTestId('sidebar-tabs').isVisible())) {
      await toolbar(mockPage).getByTestId('toggle-left-sidebar').click()
    }
    await expect(mockPage.getByTestId('sidebar-tabs')).toBeVisible()
    await expect(mockPage.getByTestId('vertical-nav')).toHaveCount(0)
  })
})
