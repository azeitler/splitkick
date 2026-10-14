import {
  test,
  expect,
  activateWorktree,
  ensureSidebarOpen,
  sidebar,
} from '../fixtures/tauri-mock'
import { defaultResponses } from '../fixtures/invoke-handlers'

// The session modal names its worktree and project in the window toolbar from
// `get_worktree`. The default mocks leave it out (other specs rely on that),
// so the specs that read the toolbar answer it with fuzzy-tiger, the worktree
// they open.
const fuzzyTiger = (defaultResponses.list_worktrees as unknown[])[0]

test.describe('Navigation', () => {
  test('sidebar shows project with worktrees', async ({ mockPage }) => {
    await ensureSidebarOpen(mockPage)

    const tree = sidebar(mockPage)
    await expect(tree.getByText('Test Project')).toBeVisible()
    await expect(tree.getByText('fuzzy-tiger', { exact: true })).toBeVisible()
    await expect(tree.getByText('calm-dolphin', { exact: true })).toBeVisible()
  })

  test.describe('session modal', () => {
    test.use({ responseOverrides: { get_worktree: fuzzyTiger } })

    test('click worktree opens its session modal', async ({ mockPage }) => {
      // A worktree click keeps the project canvas and opens the modal over it.
      // The modal's header lives in the window toolbar on desktop.
      await activateWorktree(mockPage, 'fuzzy-tiger')

      const toolbar = mockPage.getByTestId('window-toolbar')
      await expect(toolbar).toContainText('fuzzy-tiger')
      await expect(toolbar).toContainText('Test Project')
    })
  })
})
