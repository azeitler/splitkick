import { test, expect } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * The phone layout: four tabs at the root, a project as a modal over them, a
 * session pushed on top. The only e2e run at a phone viewport — every other
 * spec runs at the desktop default.
 */

const project = createProject({ name: 'Phone Project' })
const recent = createSession({
  name: 'Opened recently',
  last_opened_at: 1_700_000_900,
})
const earlier = createSession({
  name: 'Opened earlier',
  order: 1,
  last_opened_at: 1_700_000_100,
})
const starred = createSession({ name: 'Starred work', order: 2 })
const worktree = createWorktree(project.id, {
  name: 'fuzzy-tiger',
  sessions: [recent, earlier, starred],
})

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    list_all_sessions: {
      entries: [
        {
          project_id: project.id,
          project_name: project.name,
          worktree_id: worktree.id,
          worktree_name: worktree.name,
          worktree_path: worktree.path,
          sessions: [recent, earlier, starred],
        },
      ],
    },
    // Start at the tab root, with one star.
    load_ui_state: {
      ...mockUIState,
      active_project_id: null,
      starred_sessions: [
        {
          project_id: project.id,
          worktree_id: worktree.id,
          session_id: starred.id,
        },
      ],
    },
  },
})

/** The project card on the Home tab (the Continue row names the project too). */
function projectCard(page: import('@playwright/test').Page) {
  return page
    .getByTestId('mobile-home-projects')
    .getByRole('button', { name: 'Phone Project' })
}

test.describe('Phone navigation', () => {
  test.beforeEach(async ({ mockPage }) => {
    // The dev build's TanStack Query devtools logo floats in the bottom-right
    // corner, on top of the search button. It does not exist in production.
    await mockPage.addStyleTag({
      content: '.tsqd-parent-container { display: none !important; }',
    })
  })

  test('lands on Home with the tab bar and search button', async ({
    mockPage,
  }) => {
    const tabs = mockPage.getByRole('tablist', { name: 'Sections' })
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole('tab')).toHaveText([
      'Home',
      'Starred',
      'History',
      'Usage',
    ])
    await expect(mockPage.getByRole('button', { name: 'Search' })).toBeVisible()

    await expect(projectCard(mockPage)).toBeVisible()
    // Continue offers the most recently opened session.
    await expect(mockPage.getByTestId('mobile-home-continue')).toContainText(
      'Opened recently'
    )
  })

  test('has no project drawer', async ({ mockPage }) => {
    await expect(mockPage.getByTestId('mobile-tab-bar')).toBeVisible()
    await expect(mockPage.getByTestId('projects-sidebar')).toHaveCount(0)
  })

  test('switches between Starred and History', async ({ mockPage }) => {
    await mockPage.getByRole('tab', { name: 'Starred' }).click()
    await expect(mockPage.getByTestId('mobile-starred-sessions')).toContainText(
      'Starred work'
    )

    await mockPage.getByRole('tab', { name: 'History' }).click()
    const history = mockPage.getByTestId('mobile-history-sessions')
    const rows = history.getByRole('button')
    // Opened sessions only, most recently opened first.
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Opened recently')
    await expect(rows.nth(1)).toContainText('Opened earlier')
  })

  test('opens a project as a modal and closes it back to the tab', async ({
    mockPage,
  }) => {
    await projectCard(mockPage).click()

    const layer = mockPage.getByTestId('mobile-project-layer')
    await expect(layer).toHaveAttribute('data-entry', 'modal')
    await expect(
      layer.getByRole('heading', { name: 'Phone Project', level: 2 })
    ).toBeVisible()

    await layer.getByRole('button', { name: 'Close project' }).click()

    await expect(layer).toHaveCount(0)
    await expect(mockPage.getByTestId('mobile-tab-home')).toBeVisible()
  })

  test('pushes a session from History and goes back to History', async ({
    mockPage,
  }) => {
    await mockPage.getByRole('tab', { name: 'History' }).click()
    await mockPage
      .getByTestId('mobile-history-sessions')
      .getByRole('button')
      .first()
      .click()

    // The session opens over the tab, not over a project the user never saw.
    await expect(mockPage.getByTestId('mobile-project-layer')).toHaveAttribute(
      'data-entry',
      'push'
    )
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeVisible()

    await mockPage.getByTestId('session-modal-back').click()

    await expect(mockPage.getByTestId('mobile-project-layer')).toHaveCount(0)
    await expect(mockPage.getByTestId('mobile-tab-history')).toBeVisible()
  })

  test('the title bar is only the title', async ({ mockPage }) => {
    const bar = mockPage.getByTestId('titlebar-mobile')
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('button')).toHaveCount(0)
  })

  test('the Usage tab shows plan usage only', async ({ mockPage }) => {
    await mockPage.getByRole('tab', { name: /^Usage/ }).click()
    await expect(mockPage.getByTestId('mobile-usage-pane')).toBeVisible()
    await expect(
      mockPage.getByTestId('mobile-settings-pane-general')
    ).toHaveCount(0)
  })

  test('Settings opens from Home top right, and a pane opens over it', async ({
    mockPage,
  }) => {
    await mockPage.getByTestId('mobile-home-settings').click()
    const page = mockPage.getByTestId('mobile-settings-page')
    await expect(page).toBeVisible()

    await mockPage.getByTestId('mobile-settings-pane-appearance').click()
    // The dialog is a portal, so it must land above the page, not under it.
    const dialog = mockPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    const topmost = await mockPage.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role="dialog"]'),
      [box!.x + box!.width / 2, box!.y + box!.height / 2]
    )
    expect(topmost).toBe(true)
  })

  test('opens the command palette from the search button', async ({
    mockPage,
  }) => {
    await mockPage.getByRole('button', { name: 'Search' }).click()

    await expect(mockPage.getByRole('dialog')).toBeVisible()
  })
})
