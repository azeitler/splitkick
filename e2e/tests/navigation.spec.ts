import {
  test,
  expect,
  activateWorktree,
  ensureSidebarOpen,
  sidebar,
} from '../fixtures/tauri-mock'

test.describe('Navigation', () => {
  test('sidebar shows project with worktrees', async ({ mockPage }) => {
    await ensureSidebarOpen(mockPage)

    const tree = sidebar(mockPage)
    await expect(tree.getByText('Test Project')).toBeVisible()
    await expect(tree.getByText('fuzzy-tiger', { exact: true })).toBeVisible()
    await expect(tree.getByText('calm-dolphin', { exact: true })).toBeVisible()
  })

  test('click worktree opens its session modal', async ({ mockPage }) => {
    // A worktree click keeps the project canvas and opens the modal over it.
    await activateWorktree(mockPage, 'fuzzy-tiger')

    await expect(
      mockPage.getByRole('heading', { name: 'Test Project', level: 2 })
    ).toBeAttached()
  })
})
