import type { Page } from '@playwright/test'
import {
  test,
  expect,
  MOD,
} from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Every destructive action asks first, in one shared dialog: the confirm
 * button has focus, Return confirms, Esc cancels, and the key press that
 * opened the dialog does not also confirm it. Keyboard only.
 */

const project = createProject({ name: 'Acme', path: '/tmp/e2e-confirm' })
const message = (role: 'user' | 'assistant', content: string) => ({
  id: `${role}-${content.length}`,
  role,
  content,
  timestamp: Math.floor(Date.now() / 1000),
  tool_calls: [],
})
const worktree = createWorktree(project.id, {
  name: 'checkout-flow',
  branch: 'checkout-flow',
  path: '/tmp/e2e-confirm/.worktrees/checkout-flow',
  sessions: [
    createSession({
      name: 'Billing webhook retries',
      messages: [
        message('user', 'Retry failed webhooks'),
        message('assistant', 'Done.'),
      ],
      message_count: 2,
    }),
  ],
})

test.use({
  viewport: { width: 1280, height: 800 },
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    load_preferences: {
      ...mockPreferences,
      zoom_level: 100,
      confirm_session_close: true,
    },
    load_ui_state: { ...mockUIState, active_project_id: project.id },
  },
})

/** Count calls of the given backend commands from now on. */
async function recordCalls(page: Page, commands: string[]) {
  await page.evaluate(names => {
    const mock = (window as any).__JEAN_E2E_MOCK__
    const calls: string[] = ((window as any).__calls = [])
    for (const name of names) {
      const original = mock.invokeHandlers[name] ?? (() => null)
      mock.invokeHandlers[name] = (args: unknown) => {
        calls.push(name)
        return original(args)
      }
    }
  }, commands)
}
const calls = (page: Page) =>
  page.evaluate(() => [...((window as any).__calls as string[])])

async function openSessionModal(page: Page) {
  await expect(page.getByText('Acme').first()).toBeVisible({ timeout: 5000 })
  // The worktree row on the project canvas opens the session modal.
  await page.getByText('checkout-flow', { exact: true }).last().click()
  await expect(page.getByTestId('session-chat-modal-swipe')).toBeVisible({
    timeout: 3000,
  })
  await expect(page.locator('[data-session-id]').first()).toBeVisible()
}

test.describe('Destructive actions ask first', () => {
  test('Delete Session from the menu: Return opens, Return confirms', async ({
    mockPage,
  }) => {
    await openSessionModal(mockPage)
    await recordCalls(mockPage, ['archive_session', 'close_session'])

    // Open the tab menu, go to the last item ("Delete Session") by keyboard.
    const tab = mockPage.locator('[data-session-id]').first()
    await tab.focus()
    await tab.dispatchEvent('contextmenu', { button: 2 })
    const menu = mockPage.getByRole('menu')
    await expect(menu).toBeVisible()
    await mockPage.keyboard.press('End')
    await expect(
      menu.getByRole('menuitem', { name: 'Delete Session' })
    ).toBeFocused()
    await mockPage.keyboard.press('Enter')

    // The Return that picked the item opened the dialog, nothing more.
    const dialog = mockPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      'Archive session “Billing webhook retries”?'
    )
    await expect(dialog.getByRole('button', { name: 'Archive' })).toBeFocused()
    expect(await calls(mockPage)).toEqual([])

    await mockPage.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(() => calls(mockPage)).toEqual(['archive_session'])
  })

  test('Clear Context shortcut: Esc cancels, Return confirms', async ({
    mockPage,
  }) => {
    await openSessionModal(mockPage)
    await recordCalls(mockPage, ['clear_session_history'])

    await mockPage.keyboard.press(`${MOD}+Shift+k`)
    const dialog = mockPage.getByRole('alertdialog')
    await expect(dialog).toContainText('Clear context?')
    await expect(
      dialog.getByRole('button', { name: 'Clear Context' })
    ).toBeFocused()

    await mockPage.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // Esc closed only the dialog, not the session modal behind it.
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeVisible()
    expect(await calls(mockPage)).toEqual([])

    await mockPage.keyboard.press(`${MOD}+Shift+k`)
    await expect(dialog).toBeVisible()
    await mockPage.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(() => calls(mockPage)).toEqual(['clear_session_history'])
  })

  test('Close shortcut: same dialog, Return archives once', async ({
    mockPage,
  }) => {
    await openSessionModal(mockPage)
    await recordCalls(mockPage, ['archive_session', 'close_session'])

    await mockPage.keyboard.press(`${MOD}+w`)
    const dialog = mockPage.getByRole('alertdialog')
    await expect(dialog).toContainText('Archive session?')
    await expect(
      dialog.getByRole('button', { name: 'Archive & Close' })
    ).toBeFocused()
    expect(await calls(mockPage)).toEqual([])

    await mockPage.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(() => calls(mockPage)).toEqual(['archive_session'])
  })
})
