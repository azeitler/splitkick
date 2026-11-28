import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Opening a session over a slow or lost connection (phone, Web Access). The
 * view must say it loads, explain a long wait, offer Retry, and a late answer
 * for an older tap must not replace the session opened after it.
 */

const project = createProject({ name: 'Phone Project' })
const otherProject = createProject({ name: 'Other Project' })
const sessionA = createSession({
  name: 'Session A',
  last_opened_at: 1_700_000_900,
})
const sessionB = createSession({
  name: 'Session B',
  last_opened_at: 1_700_000_100,
})
const worktreeA = createWorktree(project.id, {
  name: 'worktree-a',
  sessions: [sessionA],
})
const worktreeB = createWorktree(otherProject.id, {
  name: 'worktree-b',
  sessions: [sessionB],
})

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  responseOverrides: {
    list_projects: [project, otherProject],
    list_worktrees: [worktreeA, worktreeB],
    list_all_sessions: {
      entries: [worktreeA, worktreeB].map(wt => ({
        project_id: wt.project_id,
        project_name:
          wt.project_id === project.id ? project.name : otherProject.name,
        worktree_id: wt.id,
        worktree_name: wt.name,
        worktree_path: wt.path,
        sessions: wt.sessions,
      })),
    },
    load_ui_state: { ...mockUIState, active_project_id: null },
  },
})

/**
 * Make `commands` for Phone Project (session A) hang until `releaseStall`
 * runs; calls for Other Project answer. With `fail`, they reject
 * instead. Release resolves the hung calls (a late answer) when `answer` is
 * true; either way, later calls answer at once.
 */
async function stall(page: Page, commands: string[], fail = false) {
  await page.evaluate(
    ({ commands, fail, ids }) => {
      const w = window as any
      const handlers = w.__JEAN_E2E_MOCK__.invokeHandlers
      w.__stalled = true
      w.__hung = [] as Array<() => void>
      for (const command of commands) {
        const original = handlers[command]
        handlers[command] = (args: unknown) => {
          const forA = ids.some(id => JSON.stringify(args ?? {}).includes(id))
          if (!w.__stalled || !forA) return original(args)
          if (fail) return Promise.reject(new Error('Network request failed'))
          return new Promise(resolve =>
            w.__hung.push(() => resolve(original(args)))
          )
        }
      }
    },
    { commands, fail, ids: [project.id, worktreeA.id, sessionA.id] }
  )
}

async function releaseStall(page: Page, { answer }: { answer: boolean }) {
  await page.evaluate(answer => {
    const w = window as any
    w.__stalled = false
    if (answer) for (const resolve of w.__hung) resolve()
  }, answer)
}

const PROJECT_LOAD = ['bootstrap_project', 'list_worktrees', 'get_sessions']

async function openFromHistory(page: Page, name: string) {
  await page.getByRole('tab', { name: 'History' }).click()
  await page
    .getByTestId('mobile-history-sessions')
    .getByRole('button', { name: new RegExp(name) })
    .click()
}

async function shot(page: Page, name: string) {
  const dir = process.env.LOADING_SHOT_DIR
  if (!dir) return
  const stamp = process.env.LOADING_SHOT_STAMP ?? `${Date.now()}`
  await page.screenshot({ path: `${dir}/${name}-${stamp}.png` })
}

test.describe('Phone: opening a session on a slow connection', () => {
  test.beforeEach(async ({ mockPage }) => {
    await mockPage.addStyleTag({
      content: '.tsqd-parent-container { display: none !important; }',
    })
    // Load the lazy canvas chunk now: the dev server compiles it on first
    // use, which would show the chunk's own loading card first.
    await mockPage.evaluate(
      () => import('/src/components/dashboard/ProjectCanvasView.tsx')
    )
    // History must be ready before the project loads stall.
    await mockPage.getByRole('tab', { name: 'History' }).click()
    await expect(
      mockPage.getByTestId('mobile-history-sessions').getByRole('button')
    ).toHaveCount(2)
  })

  test('says it loads, then why it waits, and Retry opens the session', async ({
    mockPage,
  }) => {
    await stall(mockPage, PROJECT_LOAD)
    await openFromHistory(mockPage, 'Session A')

    const state = mockPage.getByTestId('loading-state')
    await expect(state).toHaveAttribute('data-phase', 'loading', {
      timeout: 15_000,
    })
    await expect(state).toContainText('Loading session…')
    // A skeleton of the session, not a spinner.
    await expect(state.locator('[data-slot="skeleton"]').first()).toBeVisible()
    await expect(state.locator('.animate-spin')).toHaveCount(0)
    await shot(mockPage, 'session-loading')

    await expect(state).toHaveAttribute('data-phase', 'slow', {
      timeout: 10_000,
    })
    await expect(state).toContainText('This is taking longer than usual…')
    await shot(mockPage, 'session-loading-slow')

    await releaseStall(mockPage, { answer: false })
    await state.getByRole('button', { name: 'Retry' }).click()

    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      mockPage.locator(`[data-session-id="${sessionA.id}"]`)
    ).toHaveAttribute('aria-current', 'true')
    await expect(state).toHaveCount(0)
  })

  // The view must name the real reason: a lost connection is not "slow".
  test('says the connection is lost while offline, and goes back to loading when it returns', async ({
    mockPage,
  }) => {
    const setOffline = (offline: boolean) =>
      mockPage.evaluate(value => {
        const mock = (window as any).__JEAN_E2E_MOCK__
        mock.offline = value
        mock.eventEmitter.dispatchEvent(new CustomEvent('e2e:connection'))
      }, offline)

    await stall(mockPage, PROJECT_LOAD)
    await openFromHistory(mockPage, 'Session A')
    const state = mockPage.getByTestId('loading-state')
    await expect(state).toContainText('Loading session…', { timeout: 15_000 })

    await setOffline(true)
    await expect(state).toContainText('Connection lost. Reconnecting…')
    await expect(state).not.toContainText('This is taking longer than usual…')
    await shot(mockPage, 'session-loading-offline')

    // Back online and still waiting: the slow hint, not the offline text.
    await setOffline(false)
    await expect(state).not.toContainText('Connection lost. Reconnecting…')
    await expect(state).toContainText('This is taking longer than usual…', {
      timeout: 10_000,
    })

    await releaseStall(mockPage, { answer: false })
    await state.getByRole('button', { name: 'Retry' }).click()
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeVisible({
      timeout: 15_000,
    })
  })

  test('a late answer for the first tap does not replace the second', async ({
    mockPage,
  }) => {
    await stall(mockPage, PROJECT_LOAD)
    await openFromHistory(mockPage, 'Session A')
    await expect(mockPage.getByTestId('loading-state')).toHaveAttribute(
      'data-phase',
      'loading',
      { timeout: 15_000 }
    )

    // The loading page covers the tab: a tap on a History row lands on it.
    const row = mockPage
      .getByTestId('mobile-history-sessions')
      .getByRole('button', { name: /Session B/ })
    const box = (await row.boundingBox())!
    const covered = await mockPage.evaluate(
      ([x, y]) =>
        !!document
          .elementFromPoint(x, y)
          ?.closest('[data-testid="loading-state"]'),
      [box.x + box.width / 2, box.y + box.height / 2]
    )
    expect(covered).toBe(true)

    await mockPage
      .getByTestId('loading-state')
      .getByRole('button', { name: 'Back' })
      .click()
    await expect(mockPage.getByTestId('mobile-project-layer')).toHaveCount(0)
    await openFromHistory(mockPage, 'Session B')
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeVisible({
      timeout: 15_000,
    })
    await releaseStall(mockPage, { answer: true })

    await expect(
      mockPage.locator(`[data-session-id="${sessionB.id}"]`)
    ).toHaveAttribute('aria-current', 'true')
    await expect(
      mockPage.locator(`[data-session-id="${sessionA.id}"]`)
    ).toHaveCount(0)

    // The abandoned tap stays abandoned: opening its project later shows the
    // project, not session A.
    await mockPage.getByTestId('session-modal-back').click()
    await expect(mockPage.getByTestId('mobile-project-layer')).toHaveCount(0)
    await mockPage.getByRole('tab', { name: 'Home' }).click()
    await mockPage.getByTestId('mobile-home-segment-projects').click()
    await mockPage
      .getByTestId('mobile-home-projects')
      .getByRole('button', { name: 'Phone Project' })
      .click()
    await expect(mockPage.getByTestId('mobile-project-layer')).toHaveAttribute(
      'data-entry',
      'modal'
    )
    await expect(
      mockPage.getByTestId(`worktree-expand-${worktreeA.id}`)
    ).toBeVisible()
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toHaveCount(
      0
    )
  })

  test('Back abandons the open: the project opens later without it', async ({
    mockPage,
  }) => {
    await stall(mockPage, PROJECT_LOAD)
    await openFromHistory(mockPage, 'Session A')
    const state = mockPage.getByTestId('loading-state')
    await state.getByRole('button', { name: 'Back' }).click()
    await expect(mockPage.getByTestId('mobile-project-layer')).toHaveCount(0)
    await releaseStall(mockPage, { answer: true })

    await mockPage.getByRole('tab', { name: 'Home' }).click()
    await mockPage.getByTestId('mobile-home-segment-projects').click()
    await mockPage
      .getByTestId('mobile-home-projects')
      .getByRole('button', { name: 'Phone Project' })
      .click()
    await expect(mockPage.getByTestId('mobile-project-layer')).toHaveAttribute(
      'data-entry',
      'modal'
    )
    await expect(
      mockPage.getByTestId(`worktree-expand-${worktreeA.id}`)
    ).toBeVisible()
    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toHaveCount(
      0
    )
  })

  test('a failed load says so and offers Retry and Back', async ({
    mockPage,
  }) => {
    await stall(mockPage, PROJECT_LOAD, true)
    await openFromHistory(mockPage, 'Session A')

    const state = mockPage.getByTestId('loading-state')
    await expect(state).toHaveAttribute('data-phase', 'error', {
      timeout: 15_000,
    })
    await expect(state).toContainText('Could not load the session.')
    await expect(state).toContainText('Network request failed')
    await expect(state.getByRole('button', { name: 'Retry' })).toBeVisible()
    await shot(mockPage, 'session-loading-error')

    await state.getByRole('button', { name: 'Back' }).click()
    await expect(mockPage.getByTestId('mobile-project-layer')).toHaveCount(0)
    await expect(mockPage.getByTestId('mobile-tab-history')).toBeVisible()
  })

  test('with reduced motion it is still clearly loading', async ({
    mockPage,
  }) => {
    await mockPage.emulateMedia({ reducedMotion: 'reduce' })
    await stall(mockPage, PROJECT_LOAD)
    await openFromHistory(mockPage, 'Session A')

    const state = mockPage.getByTestId('loading-state')
    await expect(state).toHaveAttribute('role', 'status')
    await expect(state).toContainText('Loading session…')
    // The skeleton stands still, and the words say it loads.
    const skeleton = state.locator('[data-slot="skeleton"]').first()
    await expect(skeleton).toBeVisible()
    expect(
      await skeleton.evaluate(el => getComputedStyle(el).animationName)
    ).toBe('none')
    await expect(state).toContainText('This is taking longer than usual…', {
      timeout: 10_000,
    })
  })

  test('a session whose messages never come shows the loading text, the hint and Retry', async ({
    mockPage,
  }) => {
    await stall(mockPage, ['get_session'])
    await openFromHistory(mockPage, 'Session A')

    await expect(mockPage.getByTestId('session-chat-modal-swipe')).toBeVisible({
      timeout: 15_000,
    })
    const state = mockPage.getByTestId('loading-state')
    await expect(state).toContainText('Loading session…')
    await expect(state).toContainText('This is taking longer than usual…', {
      timeout: 10_000,
    })

    await shot(mockPage, 'session-messages-loading-slow')
    await releaseStall(mockPage, { answer: false })
    await state.getByRole('button', { name: 'Retry' }).click()
    await expect(state).toHaveCount(0)
  })
})
