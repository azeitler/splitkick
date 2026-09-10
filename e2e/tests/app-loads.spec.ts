import { test, expect } from '../fixtures/tauri-mock'
import { defaultResponses } from '../fixtures/invoke-handlers'

test.describe('App loads', () => {
  test('shows sidebar with project name', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project').first()).toBeVisible({
      timeout: 5000,
    })
  })

  test('opens the active project canvas with its worktrees', async ({
    mockPage,
  }) => {
    await expect(
      mockPage.getByRole('heading', { name: 'Test Project', level: 2 })
    ).toBeVisible({ timeout: 5000 })
    await expect(
      mockPage.getByRole('button', { name: 'Open fuzzy-tiger' })
    ).toBeVisible()
    await expect(
      mockPage.getByRole('button', { name: 'Open calm-dolphin' })
    ).toBeVisible()
  })
})

test.describe('App loads with an empty project', () => {
  test.use({
    responseOverrides: {
      list_worktrees: [],
      load_ui_state: defaultResponses.load_ui_state,
    },
  })

  test('shows the empty project state', async ({ mockPage }) => {
    await expect(
      mockPage.getByText('Your imagination is the only limit')
    ).toBeVisible({ timeout: 5000 })
  })
})
