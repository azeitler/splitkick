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
 * #125: sessions marked as To-Do show in the sidebar's To-Do section and on
 * Home, across projects, newest mark first. The check clears the mark.
 *
 * Set TODO_SCREENSHOT_DIR to save screenshots of both sections.
 */

const nowSeconds = Math.floor(Date.now() / 1000)
const HOUR = 60 * 60

const webApp = createProject({ name: 'web-app' })
const infra = createProject({ name: 'infra' })
const reviewPr = createSession({
  name: 'Review the login PR',
  last_message_at: nowSeconds - 3 * HOUR,
  todo_at: nowSeconds - 20 * 60,
})
const replyComments = createSession({
  name: 'Reply to review comments',
  order: 1,
  last_message_at: nowSeconds - 26 * HOUR,
  todo_at: nowSeconds - 2 * 24 * HOUR,
})
const plain = createSession({
  name: 'Refactor settings pane',
  order: 2,
  last_message_at: nowSeconds - HOUR,
})
const archived = createSession({
  name: 'Old spike',
  order: 3,
  todo_at: nowSeconds - HOUR,
  archived_at: nowSeconds - 60,
})
const dnsCheck = createSession({
  name: 'Check DNS failover',
  last_message_at: nowSeconds - 5 * HOUR,
  todo_at: nowSeconds - 4 * HOUR,
})
const webMain = createWorktree(webApp.id, {
  name: 'main',
  sessions: [reviewPr, replyComments, plain, archived],
})
const infraBranch = createWorktree(infra.id, {
  name: 'dns-failover',
  sessions: [dnsCheck],
})

function entry(
  project: ReturnType<typeof createProject>,
  worktree: ReturnType<typeof createWorktree>
) {
  return {
    project_id: project.id,
    project_name: project.name,
    worktree_id: worktree.id,
    worktree_name: worktree.name,
    worktree_path: worktree.path,
    sessions: worktree.sessions,
  }
}

test.use({
  viewport: { width: 1280, height: 800 },
  responseOverrides: {
    list_projects: [webApp, infra],
    list_worktrees: [webMain, infraBranch],
    list_all_sessions: {
      entries: [entry(webApp, webMain), entry(infra, infraBranch)],
    },
    load_preferences: { ...mockPreferences, zoom_level: 100 },
    load_ui_state: { ...mockUIState, active_project_id: null },
  },
})

test.describe('Session To-Do list', () => {
  test('lists marked sessions in the sidebar and on Home, and the check clears one', async ({
    mockPage,
  }) => {
    // Record the writes; the default mock has no handler for this command.
    await mockPage.evaluate(() => {
      const w = window as unknown as {
        __todoCalls: unknown[]
        __JEAN_E2E_MOCK__: {
          invokeHandlers: Record<string, (args?: unknown) => unknown>
        }
      }
      w.__todoCalls = []
      w.__JEAN_E2E_MOCK__.invokeHandlers.set_session_todo = args => {
        w.__todoCalls.push(args)
        return null
      }
    })

    await ensureSidebarOpen(mockPage)
    // The To-Do tab counts the marked sessions in its label.
    const todoTab = mockPage.getByTestId('sidebar-tab-todo')
    await expect(todoTab).toHaveAttribute('aria-label', 'To-Do 3')
    await todoTab.click()
    const section = sidebar(mockPage).getByTestId('sidebar-todo-section')
    await expect(section).toBeVisible()
    const sidebarRows = section.locator(
      'button[title]:not([data-testid="todo-done-button"])'
    )
    await expect(sidebarRows).toHaveCount(3)
    await expect(sidebarRows.nth(0)).toContainText('Review the login PR')
    await expect(sidebarRows.nth(0)).toContainText('web-app / main')
    await expect(sidebarRows.nth(0)).toContainText(/20m ago \(.+\)/)
    await expect(sidebarRows.nth(1)).toContainText('Check DNS failover')
    await expect(sidebarRows.nth(2)).toContainText('Reply to review comments')
    await expect(section).not.toContainText('Old spike')
    await expect(section).not.toContainText('Refactor settings pane')

    const home = mockPage.getByTestId('home-todo-sessions')
    await expect(home).toBeVisible()
    await expect(home.getByTestId('home-todo-row')).toHaveCount(3)
    await expect(home.getByTestId('home-todo-row').nth(0)).toContainText(
      /marked 20m ago \(.+\)/
    )

    const dir = process.env.TODO_SCREENSHOT_DIR
    const stamp = process.env.TODO_SCREENSHOT_STAMP ?? 'run'
    if (dir) {
      await sidebar(mockPage).screenshot({
        path: `${dir}/todo-sidebar-${stamp}.png`,
      })
      await mockPage
        .getByTestId('home-column-sessions')
        .screenshot({ path: `${dir}/todo-home-${stamp}.png` })
    }

    // Done: the check clears the mark, and the row leaves both lists.
    await home.getByTestId('todo-done-button').nth(2).click()
    await expect(home.getByTestId('home-todo-row')).toHaveCount(2)
    await expect(sidebarRows).toHaveCount(2)
    await expect(section).not.toContainText('Reply to review comments')
    const calls = await mockPage.evaluate(
      () => (window as unknown as { __todoCalls: unknown[] }).__todoCalls
    )
    expect(calls).toEqual([
      {
        worktreeId: webMain.id,
        sessionId: replyComments.id,
        todo: false,
      },
    ])
  })
})
