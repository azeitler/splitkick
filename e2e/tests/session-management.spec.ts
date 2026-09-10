import {
  test,
  expect,
  activateWorktree,
  createChatSession,
} from '../fixtures/tauri-mock'

test.describe('Session Management', () => {
  test('create new session via + button', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project').first()).toBeVisible({
      timeout: 5000,
    })

    await activateWorktree(mockPage, 'fuzzy-tiger')
    const tabs = await createChatSession(mockPage)

    // A session tab appears, named "Session …"
    await expect(tabs.first()).toBeVisible()
    await expect(tabs.first()).toContainText('Session')
  })

  test('switch between sessions', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project').first()).toBeVisible({
      timeout: 5000,
    })

    await activateWorktree(mockPage, 'fuzzy-tiger')
    await createChatSession(mockPage)
    const tabs = await createChatSession(mockPage)
    await expect(tabs).toHaveCount(2)
    await expect(
      tabs.and(mockPage.locator('[aria-current="true"]'))
    ).toHaveCount(1)

    // Click the tab that is not current; it becomes the current one.
    const other = mockPage.locator(
      '[data-session-id]:not([aria-current="true"])'
    )
    const otherId = await other.getAttribute('data-session-id')
    await other.click()

    await expect(
      mockPage.locator(`[data-session-id="${otherId}"]`)
    ).toHaveAttribute('aria-current', 'true', { timeout: 2000 })
  })

  test('rename session via double-click', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project').first()).toBeVisible({
      timeout: 5000,
    })

    await activateWorktree(mockPage, 'fuzzy-tiger')
    const tabs = await createChatSession(mockPage)
    const sessionTab = tabs.first()

    // Double-click to enter edit mode
    await sessionTab.dblclick()
    const input = sessionTab.locator('input[type="text"]')
    await expect(input).toBeVisible({ timeout: 2000 })

    await input.fill('My Renamed Session')
    await input.press('Enter')

    await expect(sessionTab).toContainText('My Renamed Session')
  })
})
