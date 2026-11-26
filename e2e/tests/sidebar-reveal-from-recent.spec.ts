import type { Locator, Page } from '@playwright/test'
import {
  test,
  expect,
  MOD,
  ensureSidebarOpen,
  openSidebarTab,
  sidebar,
} from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * #60: navigation from the Recent tab reveals the target in the Projects
 * tree. Enough projects that the target sits far below the visible part.
 */

const nowSeconds = Math.floor(Date.now() / 1000)
const PROJECT_COUNT = 30

const projects = Array.from({ length: PROJECT_COUNT }, (_, i) =>
  createProject({
    name: `project-${String(i + 1).padStart(2, '0')}`,
    path: `/tmp/e2e-reveal/project-${i + 1}`,
    order: i,
  })
)
const worktrees = projects.map((project, i) =>
  createWorktree(project.id, {
    name: `branch-${i + 1}`,
    path: `/tmp/e2e-reveal/project-${i + 1}/.worktrees/branch-${i + 1}`,
    sessions: [
      createSession({
        name: `Work in ${project.name}`,
        // The last project holds the most recent session, so it tops Recent.
        last_message_at: nowSeconds - (PROJECT_COUNT - i) * 60,
      }),
    ],
  })
)
const target = {
  project: projects[PROJECT_COUNT - 1],
  worktree: worktrees[PROJECT_COUNT - 1],
  session: worktrees[PROJECT_COUNT - 1].sessions[0],
}

test.use({
  viewport: { width: 1280, height: 720 },
  responseOverrides: {
    list_projects: projects,
    list_worktrees: worktrees,
    list_all_sessions: {
      entries: projects.map((project, i) => ({
        project_id: project.id,
        project_name: project.name,
        worktree_id: worktrees[i].id,
        worktree_name: worktrees[i].name,
        worktree_path: worktrees[i].path,
        sessions: worktrees[i].sessions,
      })),
    },
    load_preferences: { ...mockPreferences, zoom_level: 100 },
    load_ui_state: { ...mockUIState, active_project_id: null },
  },
})

const shotDir = process.env.SIDEBAR_SCREENSHOT_DIR
const shotStamp = process.env.SIDEBAR_SCREENSHOT_STAMP ?? 'shot'

async function shot(panel: Locator, name: string) {
  if (shotDir) {
    await panel.screenshot({ path: `${shotDir}/${name}-${shotStamp}.png` })
  }
}

/**
 * The row is inside the tree's scroll area and nothing sticky covers it: the
 * topmost element at its center is the row itself.
 */
async function expectRowInView(page: Page, rowId: string) {
  await expect
    .poll(
      () =>
        page.evaluate(id => {
          const row = document.querySelector(
            `[data-sidebar-row-id="${CSS.escape(id)}"]`
          )
          const scroll = document.querySelector(
            '[data-testid="sidebar-projects-scroll"]'
          )
          if (!row || !scroll) return 'missing'
          const r = row.getBoundingClientRect()
          const s = scroll.getBoundingClientRect()
          // 1px slack: `scrollIntoView` rounds scrollTop to whole pixels,
          // so a row aligned to the bottom edge can end a fraction below it.
          if (r.top < s.top - 1 || r.bottom > s.bottom + 1) return 'outside'
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2
          )
          return hit && row.contains(hit)
            ? 'visible'
            : `covered by ${hit?.textContent?.trim().slice(0, 40)}`
        }, rowId),
      { timeout: 5000 }
    )
    .toBe('visible')
}

test.describe('Sidebar reveal from the Recent tab (#60)', () => {
  test('opening a session from Recent reveals it in the Projects tree', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const panel = sidebar(mockPage)
    await expect(panel.getByText('project-01', { exact: true })).toBeVisible()

    await openSidebarTab(mockPage, 'recent')
    await panel
      .getByTestId('sidebar-recent-sessions')
      .getByText(`Work in ${target.project.name}`)
      .click()

    // Recent stays the active tab.
    await expect(
      mockPage.getByTestId('vertical-nav-recent').first()
    ).toHaveAttribute('aria-current', 'page')
    // Give the hidden tree time to expand and scroll before the switch.
    await mockPage.waitForTimeout(1000)

    await openSidebarTab(mockPage, 'projects')
    await expectRowInView(mockPage, `session:${target.session.id}`)
    await shot(panel, 'issue60-recent-then-projects')
  })

  test('CMD+K to a project from Recent shows Projects and reveals it', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const panel = sidebar(mockPage)
    await expect(panel.getByText('project-01', { exact: true })).toBeVisible()
    await openSidebarTab(mockPage, 'recent')

    await mockPage.keyboard.press(`${MOD}+k`)
    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill(target.project.name)
    await mockPage.keyboard.press('Enter')
    await expect(input).not.toBeVisible()

    await expect(
      mockPage.getByTestId('vertical-nav-projects').first()
    ).toHaveAttribute('aria-current', 'page')
    await expectRowInView(mockPage, `project:${target.project.id}`)
    await shot(panel, 'issue60-cmdk-project')
  })

  // The search finds a session that the active tab already lists: the tab
  // stays, so the row the user looks for stays in view.
  test('CMD+K to a session that Recent lists keeps the Recent tab', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const panel = sidebar(mockPage)
    await expect(panel.getByText('project-01', { exact: true })).toBeVisible()
    await openSidebarTab(mockPage, 'recent')
    await expect(
      panel
        .getByTestId('sidebar-recent-sessions')
        .getByText(`Work in ${target.project.name}`)
    ).toBeVisible()

    await mockPage.keyboard.press(`${MOD}+k`)
    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill(`Work in ${target.project.name}`)
    await mockPage
      .locator('[cmdk-item]')
      .filter({ hasText: `Work in ${target.project.name}` })
      .first()
      .click()
    await expect(input).not.toBeVisible()

    // The session opened, and Recent is still the active tab.
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeVisible()
    await expect(
      mockPage.getByTestId('vertical-nav-recent').first()
    ).toHaveAttribute('aria-current', 'page')
    await shot(panel, 'cmdk-session-keeps-recent')
  })

  test('CMD+K to a session that the tab does not list shows Projects', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const panel = sidebar(mockPage)
    await expect(panel.getByText('project-01', { exact: true })).toBeVisible()
    // Nothing is starred, so the Starred tab lists no session.
    await openSidebarTab(mockPage, 'starred')

    await mockPage.keyboard.press(`${MOD}+k`)
    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill(`Work in ${target.project.name}`)
    await mockPage
      .locator('[cmdk-item]')
      .filter({ hasText: `Work in ${target.project.name}` })
      .first()
      .click()
    await expect(input).not.toBeVisible()

    await expect(
      mockPage.getByTestId('vertical-nav-projects').first()
    ).toHaveAttribute('aria-current', 'page')
    await expectRowInView(mockPage, `session:${target.session.id}`)
  })

  // Scrolling up to a project must land it below the stuck section headers.
  test('CMD+K to a project above the view lands it below the headers', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const panel = sidebar(mockPage)
    await expect(panel.getByText('project-01', { exact: true })).toBeVisible()
    await panel.getByTestId('sidebar-projects-scroll').evaluate(el => {
      el.scrollTop = el.scrollHeight
    })
    await openSidebarTab(mockPage, 'recent')

    await mockPage.keyboard.press(`${MOD}+k`)
    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill(projects[2].name)
    await mockPage.keyboard.press('Enter')

    await expectRowInView(mockPage, `project:${projects[2].id}`)
    await shot(panel, 'issue60-cmdk-project-upward')
  })
})
