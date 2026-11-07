import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import { mockPreferences } from '../fixtures/mock-data'

// Issue #109: start a session from an agent profile in the normal New
// Session flow.
const agents = [
  {
    id: 'agent-reviewer',
    name: 'Reviewer',
    color: '#3b82f6',
    persona: 'Review every diff before it ships. Ask for tests.',
    permission: 'write',
    backend: 'claude',
    model: 'claude-sonnet-4-6',
    default_serves: null,
  },
  {
    id: 'agent-release',
    name: 'Release manager',
    color: '#f97316',
    persona: 'Keep the changelog and the version in step.',
    permission: 'manage',
    backend: null,
    model: null,
    default_serves: null,
  },
]

test.use({
  responseOverrides: {
    load_preferences: { ...mockPreferences, agent_profiles: agents },
  },
})

test.describe('New Session from an agent', () => {
  test('the dialog lists the agents and starts a session from one', async ({
    mockPage,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')
    await mockPage.getByRole('button', { name: 'New session' }).first().click()
    const dialog = mockPage.getByRole('dialog')
    await expect(
      dialog.getByRole('radio', { name: /No agent/ })
    ).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByRole('radio', { name: /Reviewer/ })).toContainText(
      'write · claude · claude-sonnet-4-6'
    )
    await expect(
      dialog.getByRole('button', { name: 'Edit Agents…' })
    ).toBeVisible()

    await dialog.getByRole('radio', { name: /Reviewer/ }).click()
    await dialog.getByRole('button', { name: /As agent Reviewer/ }).click()

    const tab = mockPage.locator('[data-session-id]', { hasText: 'Reviewer' })
    await expect(tab).toBeVisible({ timeout: 3000 })
    await expect(tab.getByTestId('agent-glyph')).toBeVisible()
    await expect(
      mockPage.getByTestId('window-toolbar').getByTestId('session-agent-chip')
    ).toContainText('Reviewer')
  })

  test('right-click on "+" opens the dialog with the first agent', async ({
    mockPage,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')
    await mockPage
      .getByRole('button', { name: 'New session' })
      .first()
      .click({ button: 'right' })
    await mockPage
      .getByRole('menuitem', { name: /New Session from Agent/ })
      .click()
    await expect(
      mockPage.getByRole('dialog').getByRole('radio', { name: /Reviewer/ })
    ).toHaveAttribute('aria-checked', 'true')
  })
})
