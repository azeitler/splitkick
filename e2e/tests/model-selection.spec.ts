import {
  test,
  expect,
  activateWorktree,
  createChatSession,
} from '../fixtures/tauri-mock'

test.describe('Model Selection', () => {
  test('model selector shows current model in chat toolbar', async ({
    mockPage,
  }) => {
    // The chat toolbar belongs to a session, so open one.
    await activateWorktree(mockPage, 'fuzzy-tiger')
    await createChatSession(mockPage)

    // The default model is "sonnet"; the toolbar names backend and model.
    const picker = mockPage.getByRole('button', {
      name: 'Choose backend and model',
    })
    await expect(picker).toBeVisible({ timeout: 3000 })
    await expect(picker).toContainText('Sonnet')
  })

  test('changing model updates the selector value', async ({ mockPage }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')
    await createChatSession(mockPage)

    const picker = mockPage.getByRole('button', {
      name: 'Choose backend and model',
    })
    await expect(picker).toContainText('Sonnet', { timeout: 3000 })
    await picker.click()

    await mockPage.getByRole('option', { name: /Opus/ }).first().click()

    await expect(picker).toContainText('Opus', { timeout: 3000 })
  })
})
