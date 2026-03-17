import { test, expect } from '../fixtures/tauri-mock'

test.describe('Preferences', () => {
  const openDialog = async (
    mockPage: Parameters<typeof test>[0]['mockPage']
  ) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })
    await mockPage.keyboard.press('Meta+,')
    const dialog = mockPage.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 3000 })
    return dialog
  }

  test('Cmd+, opens settings dialog', async ({ mockPage }) => {
    await openDialog(mockPage)
    await expect(
      mockPage.getByRole('dialog').filter({ hasText: 'Settings' })
    ).toBeVisible({ timeout: 3000 })
  })

  test('settings dialog shows navigation tabs', async ({ mockPage }) => {
    const dialog = await openDialog(mockPage)
    await expect(dialog.getByRole('button', { name: 'General' })).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Appearance' })
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Keybindings' })
    ).toBeVisible()
  })

  test('searching jumps to matching pane', async ({ mockPage }) => {
    const dialog = await openDialog(mockPage)
    const searchInput = dialog.getByPlaceholder('Search settings...')
    await searchInput.fill('keybindings')
    const result = await dialog.getByRole('option', { name: /Keybindings/i })
    await expect(result).toBeVisible()
    await result.click()
    await expect(dialog.getByText('Focus chat input')).toBeVisible()
    const keybindingsTab = dialog.getByRole('button', { name: 'Keybindings' })
    await expect(keybindingsTab).toHaveAttribute('data-active', 'true')
  })

  test('keyboard navigation selects search result', async ({ mockPage }) => {
    const dialog = await openDialog(mockPage)
    const searchInput = dialog.getByPlaceholder('Search settings...')
    await searchInput.fill('appearance')
    await searchInput.press('ArrowDown')
    await searchInput.press('ArrowDown')
    await searchInput.press('Enter')
    await expect(dialog.getByText('Color theme')).toBeVisible()
    const appearanceTab = dialog.getByRole('button', { name: 'Appearance' })
    await expect(appearanceTab).toHaveAttribute('data-active', 'true')
  })
})
