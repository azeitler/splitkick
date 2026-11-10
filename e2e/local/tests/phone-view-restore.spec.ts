import { expect, test } from '@playwright/test'
import { api, createSession, readEnv } from '../helpers'
import { shot, uniqueName } from './ui'

/**
 * iOS ends the Home Screen app in the background, and the next open is a
 * new page: memory and sessionStorage are gone, localStorage stays. The phone
 * must come back to its own session, not to the host's last view, and must
 * not move the host's view (#72, gap 2 in mobile-gap-analysis.md).
 */
test.use({
  browserName: 'webkit',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
})

interface ViewFields {
  active_project_id: string | null
  active_worktree_id: string | null
  mobile_active_tab: string | null
}

test('the phone reopens its own session after the page ends (#72)', async ({
  context,
}) => {
  const { a, alphaA } = readEnv()
  const name = uniqueName('Phone view')
  await createSession(a, alphaA, name)
  const hostBefore = await api<ViewFields>(a, 'load_ui_state')

  const page = await context.newPage()
  await page.goto(`${a.url}/?token=${a.token}`)
  // Open the session through the phone's search, as a user does.
  await page.getByRole('button', { name: 'Search' }).click()
  await page.keyboard.type(name)
  await expect(
    page.getByRole('option', { name: new RegExp(name) }).first()
  ).toBeVisible()
  await page.keyboard.press('Enter')
  const modal = page.getByTestId('session-chat-modal-swipe')
  await expect(modal).toBeVisible()
  await expect(modal.getByText(name, { exact: true }).first()).toBeVisible()

  // The app goes to the background, then iOS ends it.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.close()

  const reopened = await context.newPage()
  await reopened.goto(a.url)
  const restored = reopened.getByTestId('session-chat-modal-swipe')
  await expect(restored).toBeVisible()
  await expect(restored.getByText(name, { exact: true }).first()).toBeVisible()
  await shot(reopened, 'phone-view-restored')

  // The reload log counted it as an end in the background.
  const kinds = await reopened.evaluate(() => {
    const log = JSON.parse(localStorage.getItem('jean:web-reload-log') ?? '{}')
    return (log.entries ?? []).map((entry: { kind: string }) => entry.kind)
  })
  expect(kinds.at(-1)).toBe('background-end')

  // The host's view did not move to the phone's.
  const hostAfter = await api<ViewFields>(a, 'load_ui_state')
  expect({
    project: hostAfter.active_project_id,
    worktree: hostAfter.active_worktree_id,
    tab: hostAfter.mobile_active_tab,
  }).toEqual({
    project: hostBefore.active_project_id,
    worktree: hostBefore.active_worktree_id,
    tab: hostBefore.mobile_active_tab,
  })
})
