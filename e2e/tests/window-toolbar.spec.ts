import {
  test,
  expect,
  MOD,
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

// The desktop window toolbar belongs to the view on screen: the project
// canvas and the session modal put their title and actions in it, and the
// one below takes it back when the modal closes.
test.describe('Window toolbar', () => {
  test.use({ responseOverrides: { get_worktree: fuzzyTiger } })

  test('shows the project, then the session, then the project again', async ({
    mockPage,
  }) => {
    const toolbar = mockPage.getByTestId('window-toolbar')

    await ensureSidebarOpen(mockPage)
    await sidebar(mockPage).getByText('Test Project', { exact: true }).click()
    await expect(toolbar).toContainText('Test Project')
    await expect(
      toolbar.getByRole('textbox', { name: 'Filter worktrees' })
    ).toBeVisible()

    await activateWorktree(mockPage, 'fuzzy-tiger')
    await expect(toolbar).toContainText('fuzzy-tiger')
    await expect(toolbar).toContainText('Test Project')
    await expect(toolbar.getByRole('button', { name: 'Close' })).toBeVisible()

    await toolbar.getByRole('button', { name: 'Close' }).click()
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeHidden()
    await expect(
      toolbar.getByRole('textbox', { name: 'Filter worktrees' })
    ).toBeVisible()
  })

  test('takes the sidebar toggle when the sidebar hides', async ({
    mockPage,
  }) => {
    const toolbar = mockPage.getByTestId('window-toolbar')
    await ensureSidebarOpen(mockPage)
    await expect(
      mockPage.getByTestId('sidebar-header').getByTestId('toggle-left-sidebar')
    ).toBeVisible()
    await expect(toolbar.getByTestId('toggle-left-sidebar')).toHaveCount(0)

    await mockPage.keyboard.press(`${MOD}+b`)

    await expect(mockPage.getByTestId('sidebar-column')).toHaveCount(0)
    await expect(toolbar.getByTestId('toggle-left-sidebar')).toBeVisible()
  })

  test('keeps app items in the sidebar footer', async ({ mockPage }) => {
    await ensureSidebarOpen(mockPage)
    const footer = mockPage.getByTestId('sidebar-footer')
    await expect(footer.getByRole('button', { name: 'Settings' })).toBeVisible()
    await expect(footer.getByTestId('sidebar-more')).toBeVisible()
  })
})
