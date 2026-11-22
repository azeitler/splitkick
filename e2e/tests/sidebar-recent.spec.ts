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
 * The sidebar's Projects / Recent tabs: Recent lists the latest sessions of
 * every project, each row naming its project and workspace.
 */

const nowSeconds = Math.floor(Date.now() / 1000)
const HOUR = 60 * 60

const jean = createProject({ name: 'jean' })
const devops = createProject({ name: 'acme-devops' })
const sidebarWork = createSession({
  name: 'Sidebar recents tab',
  last_message_at: nowSeconds - 60,
})
const imageViewer = createSession({
  name: 'Image viewer zoom',
  order: 1,
  last_message_at: nowSeconds - 2 * HOUR,
})
const tunnelDocs = createSession({
  name: 'Tunnel docs',
  last_message_at: nowSeconds - 6 * 24 * HOUR,
})
const jeanMain = createWorktree(jean.id, {
  name: 'main',
  sessions: [sidebarWork, imageViewer],
})
const devopsBranch = createWorktree(devops.id, {
  name: 'fix-mail-archive',
  sessions: [tunnelDocs],
})

function allSessionsEntry(
  project: ReturnType<typeof createProject>,
  worktree: ReturnType<typeof createWorktree>,
  sessions: ReturnType<typeof createSession>[]
) {
  return {
    project_id: project.id,
    project_name: project.name,
    worktree_id: worktree.id,
    worktree_name: worktree.name,
    worktree_path: worktree.path,
    sessions,
  }
}

test.use({
  responseOverrides: {
    list_projects: [jean, devops],
    list_worktrees: [jeanMain],
    list_all_sessions: {
      entries: [
        allSessionsEntry(jean, jeanMain, [sidebarWork, imageViewer]),
        allSessionsEntry(devops, devopsBranch, [tunnelDocs]),
      ],
    },
    load_ui_state: {
      ...mockUIState,
      active_project_id: null,
    },
  },
})

test.describe('Sidebar Recent tab', () => {
  test('lists recent sessions across projects with project / worktree', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const panel = sidebar(mockPage)

    await expect(
      panel.getByRole('tab', { name: 'Projects', selected: true })
    ).toBeVisible()
    await panel.getByRole('tab', { name: 'Recent' }).click()

    const recent = panel.getByTestId('sidebar-recent-sessions')
    const rows = recent.getByRole('button')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Sidebar recents tab')
    await expect(rows.nth(0)).toContainText('jean / main')
    await expect(rows.nth(2)).toContainText('Tunnel docs')
    await expect(rows.nth(2)).toContainText('acme-devops / fix-mail-archive')
    await expect(recent.getByRole('region', { name: 'Today' })).toBeVisible()
    await expect(recent.getByRole('region', { name: 'Earlier' })).toBeVisible()

    if (process.env.SIDEBAR_SCREENSHOT_DIR) {
      await panel.screenshot({
        path: `${process.env.SIDEBAR_SCREENSHOT_DIR}/sidebar-recent.png`,
      })
    }

    // Back to Projects: the tree is there again.
    await panel.getByRole('tab', { name: 'Projects' }).click()
    await expect(recent).toHaveCount(0)
    await expect(panel.getByText('jean', { exact: true })).toBeVisible()

    if (process.env.SIDEBAR_SCREENSHOT_DIR) {
      await panel.screenshot({
        path: `${process.env.SIDEBAR_SCREENSHOT_DIR}/sidebar-projects.png`,
      })
    }
  })
})
