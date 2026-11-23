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
 * Vertical navigation, the desktop app's layout: Home and the tabs in a nav
 * left of the panel, the sidebar toggle in the main toolbar, and on Home no
 * panel and two footers. Web access keeps the sidebar with the tab strip.
 * Sample data only.
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

// Two active schedules and a paused one; three archived items.
const schedules = [true, true, false].map((enabled, i) => ({
  id: `schedule-${i + 1}`,
  origin: 'user',
  name: ['Nightly build check', 'Weekly report', 'Paused digest'][i],
  enabled,
  session_id: worktrees[0].sessions[0].id,
  worktree_id: worktrees[0].id,
  prompt: 'Run the checks',
  reason: '',
  fire_at_unix: Math.floor(now) + (i + 1) * 3600,
  created_at_unix: Math.floor(now) - 3600,
}))
const archivedWorktrees = [
  createWorktree(projects[0].id, {
    name: 'old-spike',
    branch: 'spike/old',
    archived_at: Math.floor(now) - 7200,
  }),
]
const archivedSessions = ['Draft release notes', 'Login spike'].map(
  (name, i) => ({
    session: createSession({ name, archived_at: Math.floor(now) - 600 * i }),
    worktree_id: worktrees[0].id,
    worktree_name: worktrees[0].name,
    worktree_path: worktrees[0].path,
    project_id: projects[0].id,
    project_name: projects[0].name,
  })
)

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

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no box')
  return b
}

/** The nav animates its width (200 ms); wait until it settles. */
async function expectNavWidth(page: Page, width: number) {
  await expect
    .poll(async () =>
      Math.round((await box(page.getByTestId('vertical-nav'))).width)
    )
    .toBe(width)
}

/** Every item lies inside the nav (its 1 px right border excluded) and its
 *  content does not overflow; collapsed, the icon is centred. */
async function expectItemsFit(page: Page, collapsed: boolean) {
  const nav = await box(page.getByTestId('vertical-nav'))
  for (const id of NAV_ITEMS) {
    const item = navItem(page, id)
    const b = await box(item)
    expect(b.x, id).toBeGreaterThanOrEqual(nav.x)
    expect(b.x + b.width, id).toBeLessThanOrEqual(nav.x + nav.width - 1)
    // The badge may reach past the row (checked against the nav below);
    // the icon, label and count must not.
    const overflow = await item.evaluate(el => {
      const badge = el.querySelector<HTMLElement>(
        '[data-testid^="vertical-nav-badge-"]'
      )
      if (badge) badge.style.display = 'none'
      const value = el.scrollWidth - el.clientWidth
      if (badge) badge.style.display = ''
      return value
    })
    expect(overflow, `${id} overflows`).toBeLessThanOrEqual(0)
    if (collapsed) {
      const icon = await box(item.locator('svg').first())
      const offset = icon.x + icon.width / 2 - (b.x + b.width / 2)
      expect(Math.abs(offset), `${id} icon centred`).toBeLessThanOrEqual(1)
    }
  }
}

const NAV_ITEMS = [
  'home',
  'projects',
  'recent',
  'starred',
  'todo',
  'agents',
  'graphs',
  'scheduled',
  'archived',
  'collapse',
]

function withData(openProject: boolean, navCollapsed = false) {
  test.use({
    viewport: { width: 1280, height: 720 },
    responseOverrides: {
      list_projects: projects,
      list_worktrees: worktrees,
      list_all_sessions: { entries },
      list_schedules: schedules,
      list_archived_worktrees: archivedWorktrees,
      list_all_archived_sessions: archivedSessions,
      load_preferences: {
        ...mockPreferences,
        zoom_level: 100,
        has_seen_feature_tour: true,
      },
      load_ui_state: {
        ...mockUIState,
        active_project_id: openProject ? projects[0].id : null,
        expanded_project_ids: [projects[0].id],
        left_sidebar_visible: true,
        left_sidebar_size: 250,
        vertical_nav_collapsed: navCollapsed,
        starred_sessions: entries.map(entry => ({
          project_id: entry.project_id,
          worktree_id: entry.worktree_id,
          session_id: entry.sessions[0].id,
        })),
      },
    },
  })
}

test.describe('Web access', () => {
  withData(true)

  test('keeps the sidebar with the tab strip and its rows', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Acme Web').first()).toBeVisible()
    if (!(await mockPage.getByTestId('sidebar-tabs').isVisible())) {
      await toolbar(mockPage).getByTestId('toggle-left-sidebar').click()
    }
    await expect(mockPage.getByTestId('sidebar-tabs')).toBeVisible()
    await expect(mockPage.getByTestId('sidebar-home-row')).toBeVisible()
    await expect(mockPage.getByTestId('vertical-nav')).toHaveCount(0)
    await expect(mockPage.getByTestId('vertical-nav-layout')).toHaveCount(0)
    // The tab-strip sidebar keeps its rows, and the project its Archived row.
    await expect(mockPage.getByTestId('sidebar-scheduled-row')).toBeVisible()
    await expect(mockPage.getByTestId('sidebar-archived-row')).toBeVisible()
    const projectArchived = mockPage.getByTestId(
      `project-archived-row-${projects[0].id}`
    )
    await expect(projectArchived).toContainText('Archived3')
    await expect(
      mockPage.getByTestId(`project-archived-row-${projects[1].id}`)
    ).toHaveCount(0)
    await shot(mockPage, 'sidebar-web-access')

    // It opens the Archived view filtered to the project.
    await projectArchived.click()
    await expect(mockPage.getByTestId('archived-view')).toBeVisible()
    await expect(
      mockPage
        .getByTestId('archived-view')
        .getByLabel('Project', { exact: true })
    ).toHaveValue(projects[0].id)
    await expect(mockPage.getByTestId('archived-row')).toHaveCount(3)
    await expect(projectArchived).toHaveAttribute('aria-current', 'page')
    await expect(
      mockPage.getByTestId('sidebar-archived-row')
    ).not.toHaveAttribute('aria-current')
    await shot(mockPage, 'project-archived-row')
  })
})

test.describe('Vertical navigation, a project open', () => {
  withData(true)

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
    // Scheduled and Archived are nav items, not rows in the panel.
    await expect(
      mockPage.getByTestId('vertical-nav-count-scheduled')
    ).toHaveText('2')
    await expect(
      mockPage.getByTestId('vertical-nav-count-archived')
    ).toHaveText('3')
    await expect(mockPage.getByTestId('sidebar-scheduled-row')).toHaveCount(0)
    await expect(mockPage.getByTestId('sidebar-archived-row')).toHaveCount(0)
    await navItem(mockPage, 'scheduled').click()
    await expect(navItem(mockPage, 'scheduled')).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(column.getByTestId('projects-sidebar')).toBeVisible()
    await navItem(mockPage, 'archived').click()
    await expect(mockPage.getByTestId('archived-view')).toBeVisible()
    await expect(mockPage.getByTestId('archived-row')).toHaveCount(3)
    await expect(navItem(mockPage, 'archived')).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(navItem(mockPage, 'scheduled')).not.toHaveAttribute(
      'aria-current'
    )
    await shot(mockPage, 'vertical-nav-archived')

    // Collapsed: icons and badges, To-Do blue.
    await navItem(mockPage, 'collapse').click()
    await expect(mockPage.getByTestId('vertical-nav')).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    await expectNavWidth(mockPage, 46)
    await expect(mockPage.getByTestId('vertical-nav-badge-starred')).toHaveText(
      '3'
    )
    const todoBadge = mockPage.getByTestId('vertical-nav-badge-todo')
    await expect(todoBadge).toHaveText('2')
    await expect(todoBadge).toHaveClass(/bg-blue-600/)
    await expect(navItem(mockPage, 'todo')).toHaveAccessibleName(
      'To-Do, 2 waiting for you'
    )
    await expect(
      mockPage.getByTestId('vertical-nav-badge-scheduled')
    ).toHaveText('2')
    await expect(navItem(mockPage, 'archived')).toHaveAccessibleName(
      'Archived, 3 archived'
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

test.describe('Vertical navigation layout geometry', () => {
  withData(true)

  test('expanded: nav 168 px, panel next to it, toolbar right of the column', async ({
    mockPage,
  }) => {
    await asDesktopApp(mockPage)
    await expectNavWidth(mockPage, 168)
    const column = await box(mockPage.getByTestId('sidebar-column'))
    const nav = await box(mockPage.getByTestId('vertical-nav'))
    const panel = await box(mockPage.getByTestId('vertical-nav-panel'))
    const strip = await box(mockPage.getByTestId('vertical-nav-titlebar'))
    const footer = await box(
      mockPage.getByTestId('sidebar-column').getByTestId('sidebar-footer')
    )
    const bar = await box(toolbar(mockPage))

    expect(column.width).toBe(418)
    expect(panel.x).toBe(nav.x + nav.width)
    expect(panel.width).toBe(250)
    // The window-controls strip and the toolbar share one line.
    expect(strip.height).toBe(bar.height)
    expect(nav.y).toBe(strip.y + strip.height)
    // The footer spans nav and panel at the bottom of the window.
    expect(footer.x).toBe(column.x)
    expect(footer.width).toBe(column.width)
    expect(footer.y + footer.height).toBe(720)
    // The toolbar starts right of the column and its 1 px separator.
    expect(bar.x).toBe(column.x + column.width + 1)

    // Labels and counts show, inside their rows.
    await expect(navItem(mockPage, 'starred')).toContainText('Starred')
    const count = await box(mockPage.getByTestId('vertical-nav-count-starred'))
    const row = await box(navItem(mockPage, 'starred'))
    expect(count.x + count.width).toBeLessThanOrEqual(row.x + row.width)
    await expectItemsFit(mockPage, false)
  })

  test('collapsed: nav 46 px, icons centred, badges inside, the panel takes the room', async ({
    mockPage,
  }) => {
    await asDesktopApp(mockPage)
    await navItem(mockPage, 'collapse').click()
    await expectNavWidth(mockPage, 46)

    const column = await box(mockPage.getByTestId('sidebar-column'))
    const nav = await box(mockPage.getByTestId('vertical-nav'))
    const panel = await box(mockPage.getByTestId('vertical-nav-panel'))
    // The column keeps its width; the panel grows by what the nav gave up.
    expect(column.width).toBe(418)
    expect(panel.x).toBe(nav.x + nav.width)
    expect(panel.width).toBe(372)

    // Icons only: no labels, no row counts.
    for (const id of NAV_ITEMS) {
      const text = (await navItem(mockPage, id).innerText()).replace(/\d/g, '')
      expect(text.trim(), `${id} label`).toBe('')
    }
    await expect(
      mockPage.getByTestId('vertical-nav-count-starred')
    ).toHaveCount(0)
    await expectItemsFit(mockPage, true)

    // Badges sit on the icon's top right, inside the nav.
    for (const id of ['starred', 'todo']) {
      const badge = await box(mockPage.getByTestId(`vertical-nav-badge-${id}`))
      const icon = await box(navItem(mockPage, id).locator('svg').first())
      expect(badge.x + badge.width, `${id} badge`).toBeLessThanOrEqual(
        nav.x + nav.width - 1
      )
      expect(badge.x, `${id} badge`).toBeGreaterThan(icon.x + icon.width / 2)
      expect(badge.y, `${id} badge`).toBeLessThan(icon.y)
    }

    // A tooltip names the item.
    await navItem(mockPage, 'todo').hover()
    await expect(mockPage.getByRole('tooltip')).toContainText(
      'To-Do · 2 waiting for you'
    )

    // Expand brings the labels and the old widths back.
    await navItem(mockPage, 'collapse').click()
    await expectNavWidth(mockPage, 168)
    expect((await box(mockPage.getByTestId('vertical-nav-panel'))).width).toBe(
      250
    )
    await expect(navItem(mockPage, 'starred')).toContainText('Starred')
  })

  test('Home collapsed: nav below the toolbar, compact footer, Home footer to the edge', async ({
    mockPage,
  }) => {
    await asDesktopApp(mockPage)
    await navItem(mockPage, 'collapse').click()
    await navItem(mockPage, 'home').click()
    await expect(mockPage.getByTestId('vertical-nav-layout')).toHaveAttribute(
      'data-home',
      'true'
    )
    await expectNavWidth(mockPage, 46)

    const bar = await box(toolbar(mockPage))
    const nav = await box(mockPage.getByTestId('vertical-nav'))
    const footer = await box(
      mockPage.getByTestId('home-footer-row').getByTestId('sidebar-footer')
    )
    const homeFooter = await box(mockPage.getByTestId('home-footer'))

    // One top bar over the whole window; the nav starts under it.
    expect(bar.x).toBe(0)
    expect(bar.width).toBe(1280)
    expect(nav.x).toBe(0)
    expect(nav.y).toBe(bar.y + bar.height)
    expect(nav.y + nav.height).toBe(footer.y)
    // Compact footer at the left, the Home footer fills the rest.
    expect(footer.x).toBe(0)
    expect(footer.width).toBeLessThan(260)
    expect(homeFooter.x).toBe(footer.x + footer.width + 1)
    expect(homeFooter.x + homeFooter.width).toBe(1280)
    expect(homeFooter.height).toBe(footer.height)
    expect(footer.y + footer.height).toBe(720)
    await expectItemsFit(mockPage, true)
  })
})

test.describe('Vertical navigation collapsed on start', () => {
  withData(true, true)

  test('restores the collapsed nav from the UI state', async ({ mockPage }) => {
    await asDesktopApp(mockPage)
    await expect(mockPage.getByTestId('vertical-nav')).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    await expectNavWidth(mockPage, 46)
    expect((await box(mockPage.getByTestId('vertical-nav-panel'))).width).toBe(
      372
    )
    await expectItemsFit(mockPage, true)
  })
})
