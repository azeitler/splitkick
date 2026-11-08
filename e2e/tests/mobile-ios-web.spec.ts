import { test, expect } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * iOS web access at a phone viewport (#114): the status-bar band that keeps
 * iOS 26's edge blur off the session header, and the composer actions.
 */

const project = createProject({ name: 'Phone Project' })
const session = createSession({
  name: 'Composer session',
  last_opened_at: 1_700_000_900,
})
const worktree = createWorktree(project.id, {
  name: 'fuzzy-tiger',
  sessions: [session],
})

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    list_all_sessions: {
      entries: [
        {
          project_id: project.id,
          project_name: project.name,
          worktree_id: worktree.id,
          worktree_name: worktree.name,
          worktree_path: worktree.path,
          sessions: [session],
        },
      ],
    },
    load_ui_state: { ...mockUIState, active_project_id: null },
  },
})

test.describe('iOS web access', () => {
  test.beforeEach(async ({ mockPage }) => {
    // An iPhone's status bar inset; env() is 0 in a desktop browser.
    await mockPage.addStyleTag({
      content: `:root { --safe-area-top: 59px !important; }
        .tsqd-parent-container { display: none !important; }`,
    })
    await mockPage.getByRole('tab', { name: 'History' }).click()
    await mockPage
      .getByTestId('mobile-history-sessions')
      .getByRole('button')
      .first()
      .click()
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeVisible()
  })

  test('a solid fixed band spans the top edge under the status bar', async ({
    mockPage,
  }) => {
    // iOS 26 skips its edge blur only when the top edge hit-tests to a fixed,
    // full-width box with an opaque background.
    const top = await mockPage.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, 4)
      const style = el ? getComputedStyle(el) : null
      const rect = el?.getBoundingClientRect()
      return {
        testId: el?.getAttribute('data-testid'),
        position: style?.position,
        background: style?.backgroundColor,
        width: rect?.width,
        height: rect?.height,
      }
    })
    expect(top.testId).toBe('status-bar-band')
    expect(top.position).toBe('fixed')
    expect(top.width).toBe(390)
    expect(top.height).toBe(59)
    expect(top.background).not.toMatch(/rgba\(.*, 0\)|transparent/)

    // The session header starts below it, not under it.
    const back = await mockPage.getByTestId('session-modal-back').boundingBox()
    expect(back?.y).toBeGreaterThanOrEqual(59)
  })

  test('while a turn runs, Queue is the primary action, not Cancel', async ({
    mockPage,
    emitEvent,
  }) => {
    const textarea = mockPage.locator('textarea').first()
    await textarea.fill('Next prompt')
    await emitEvent('chat:sending', {
      session_id: session.id,
      worktree_id: worktree.id,
    })

    const queue = mockPage.getByRole('button', { name: 'Queue', exact: true })
    const cancel = mockPage.getByRole('button', { name: 'Cancel', exact: true })
    await expect(queue).toBeVisible()
    await expect(queue).toHaveClass(/\bbg-primary\b/)
    await expect(cancel).not.toHaveClass(/\bbg-primary\b/)
  })

  test('tapping Send keeps the textarea focused and sends', async ({
    mockPage,
  }) => {
    const textarea = mockPage.locator('textarea').first()
    await textarea.tap()
    await textarea.fill('Hello from the phone')
    // The send flow focuses the textarea again afterwards, so count blurs
    // rather than checking the end state.
    await textarea.evaluate(el => {
      ;(window as unknown as { blurs: number }).blurs = 0
      el.addEventListener('blur', () => {
        ;(window as unknown as { blurs: number }).blurs++
      })
    })

    await mockPage.getByRole('button', { name: 'Send', exact: true }).tap()

    // Focus never left the textarea, so iOS keeps the keyboard open and the
    // composer does not jump under the finger.
    await expect(textarea).toHaveValue('')
    await expect(textarea).toBeFocused()
    expect(
      await mockPage.evaluate(
        () => (window as unknown as { blurs: number }).blurs
      )
    ).toBe(0)
  })
})
