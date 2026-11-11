import type { Locator, Page } from '@playwright/test'
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
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * The Starred section: a click reveals the session in the Projects tree, and
 * the stars can be reordered by drag and drop. Enough projects that the
 * revealed row sits far below the visible part of the tree.
 */

const PROJECT_COUNT = 30
const names = [
  'Release checklist',
  'Billing webhook retries',
  'Onboarding copy pass',
]

const projects = Array.from({ length: PROJECT_COUNT }, (_, i) =>
  createProject({
    name: `project-${String(i + 1).padStart(2, '0')}`,
    path: `/tmp/e2e-starred/project-${i + 1}`,
    order: i,
  })
)
const worktrees = projects.map((project, i) =>
  createWorktree(project.id, {
    name: `branch-${i + 1}`,
    path: `/tmp/e2e-starred/project-${i + 1}/.worktrees/branch-${i + 1}`,
    sessions: [
      createSession({ name: names[i % names.length] + ` (${project.name})` }),
    ],
  })
)
// Stars on the last three projects, the last one first.
const starred = [29, 27, 28].map(i => ({
  project: projects[i],
  worktree: worktrees[i],
  session: worktrees[i].sessions[0],
}))

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
    load_ui_state: {
      ...mockUIState,
      active_project_id: null,
      starred_sessions: starred.map(star => ({
        project_id: star.project.id,
        worktree_id: star.worktree.id,
        session_id: star.session.id,
      })),
    },
  },
})

const shotDir = process.env.SIDEBAR_SCREENSHOT_DIR
const shotStamp = process.env.SIDEBAR_SCREENSHOT_STAMP ?? 'shot'

async function shot(target: Locator, name: string) {
  if (shotDir) {
    await target.screenshot({ path: `${shotDir}/${name}-${shotStamp}.png` })
  }
}

function starredSection(page: Page): Locator {
  return page.getByTestId('sidebar-starred-section')
}

async function starOrder(page: Page): Promise<string[]> {
  return starredSection(page)
    .locator('[data-shortcut-row-id]')
    .evaluateAll(rows =>
      rows.map(row => (row as HTMLElement).dataset.shortcutRowId ?? '')
    )
}

/** Record the starred order of every UI-state write the app makes. */
async function recordStarWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Handler = (args?: Record<string, unknown>) => unknown
    const mock = (
      window as unknown as {
        __JEAN_E2E_MOCK__: { invokeHandlers: Record<string, Handler> }
      }
    ).__JEAN_E2E_MOCK__
    const original = mock.invokeHandlers.save_ui_state
    const writes: string[][] = []
    ;(window as unknown as { __starWrites: string[][] }).__starWrites = writes
    mock.invokeHandlers.save_ui_state = args => {
      const state = (args?.uiState ?? args?.ui_state) as {
        starred_sessions?: { session_id: string }[]
      }
      writes.push((state.starred_sessions ?? []).map(s => s.session_id))
      return original?.(args)
    }
  })
}

async function lastStarWrite(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const writes = (window as unknown as { __starWrites: string[][] })
      .__starWrites
    return writes.at(-1) ?? null
  })
}

test.describe('Sidebar Starred section', () => {
  test('a click on a star reveals its session in the Projects tree', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const panel = sidebar(mockPage)
    await expect(panel.getByText('project-01', { exact: true })).toBeVisible()

    const target = starred[0]
    await starredSection(mockPage)
      .locator(`[data-shortcut-row-id="${target.session.id}"]`)
      .click()

    const rowId = `session:${target.session.id}`
    await expect
      .poll(
        () =>
          mockPage.evaluate(id => {
            const row = document.querySelector(
              `[data-sidebar-row-id="${CSS.escape(id)}"]`
            )
            const scroll = document.querySelector(
              '[data-testid="sidebar-projects-scroll"]'
            )
            if (!row || !scroll) return 'missing'
            const r = row.getBoundingClientRect()
            const s = scroll.getBoundingClientRect()
            return r.top >= s.top && r.bottom <= s.bottom
              ? 'visible'
              : 'outside'
          }, rowId),
        { timeout: 5000 }
      )
      .toBe('visible')
  })

  test('stars reorder by drag and drop, and the order is persisted', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const section = starredSection(mockPage)
    await expect(section).toBeVisible()
    await recordStarWrites(mockPage)

    const ids = starred.map(star => star.session.id)
    await expect.poll(() => starOrder(mockPage)).toEqual(ids)

    const source = section.locator(`[data-shortcut-row-id="${ids[0]}"]`)
    const target = section.locator(`[data-shortcut-row-id="${ids[2]}"]`)
    const sourceBox = await source.boundingBox()
    const targetBox = await target.boundingBox()
    expect(sourceBox).not.toBeNull()
    expect(targetBox).not.toBeNull()
    if (!sourceBox || !targetBox) return

    await shot(
      mockPage.getByTestId('sidebar-pinned-sections'),
      'starred-before'
    )
    await mockPage.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    )
    await mockPage.mouse.down()
    await mockPage.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2 + 8,
      { steps: 4 }
    )
    // The lower half of the last row: drop below it.
    await mockPage.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height * 0.85,
      { steps: 12 }
    )
    await expect(section.getByTestId('drop-indicator')).toBeVisible()
    await shot(
      mockPage.getByTestId('sidebar-pinned-sections'),
      'starred-dragging'
    )
    await mockPage.mouse.up()

    const moved = [ids[1], ids[2], ids[0]]
    await expect.poll(() => starOrder(mockPage)).toEqual(moved)
    await expect(section.getByTestId('drop-indicator')).toHaveCount(0)
    await expect.poll(() => lastStarWrite(mockPage)).toEqual(moved)
    await shot(mockPage.getByTestId('sidebar-pinned-sections'), 'starred-after')
  })

  test('Move Up in the row menu reorders and persists', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const section = starredSection(mockPage)
    await expect(section).toBeVisible()
    await recordStarWrites(mockPage)
    const ids = starred.map(star => star.session.id)

    await section
      .locator(`[data-shortcut-row-id="${ids[1]}"]`)
      .click({ button: 'right' })
    await mockPage.getByRole('menuitem', { name: /Move Up/ }).click()

    const moved = [ids[1], ids[0], ids[2]]
    await expect.poll(() => starOrder(mockPage)).toEqual(moved)
    await expect.poll(() => lastStarWrite(mockPage)).toEqual(moved)
  })
})
