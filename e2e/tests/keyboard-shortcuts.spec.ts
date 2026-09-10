import { test, expect, MOD, ensureSidebarOpen } from '../fixtures/tauri-mock'

test.describe('Keyboard shortcuts', () => {
  test('Cmd+K opens command palette', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.keyboard.press(`${MOD}+k`)

    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })
  })

  test('Cmd+B toggles sidebar panel', async ({ mockPage }) => {
    // The Home row is the sidebar's first row, so it tells whether it is open.
    await ensureSidebarOpen(mockPage)
    const home = mockPage.getByTestId('sidebar-home-row')

    await mockPage.keyboard.press(`${MOD}+b`)
    await expect(home).not.toBeVisible({ timeout: 2000 })

    await mockPage.keyboard.press(`${MOD}+b`)
    await expect(home).toBeVisible({ timeout: 2000 })
  })

  test('Escape closes command palette', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.keyboard.press(`${MOD}+k`)
    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })

    await mockPage.keyboard.press('Escape')
    await expect(input).not.toBeVisible({ timeout: 2000 })
  })
})
