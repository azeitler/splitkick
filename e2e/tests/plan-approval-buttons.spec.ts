import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import type { Page } from '@playwright/test'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * A Claude plan that ends its turn shows the Approve and YOLO buttons at the
 * end of the plan box, in the normal and the compact chat view. So does a
 * 1.6.0/1.6.1 plan whose call timed out or paused (a deny text as its result).
 * A plan that a 1.6.x session approved inside its own turn shows no buttons.
 * Approve and YOLO start the next turn in build and yolo mode.
 */

const PLAN = '## Plan\n\n1. Add the settings field\n2. Write the tests'
const TOOL_ID = 'toolu_e2e_plan'
const now = Math.floor(Date.now() / 1000)

const project = createProject({ name: 'Acme' })

function planTool(output?: string) {
  return {
    id: TOOL_ID,
    name: 'ExitPlanMode',
    input: { plan: PLAN },
    ...(output ? { output } : {}),
  }
}

function userMessage(sessionId: string, text: string) {
  return {
    id: `${sessionId}-u0`,
    session_id: sessionId,
    role: 'user',
    content: text,
    timestamp: now - 120,
    tool_calls: [],
  }
}

function planMessage(sessionId: string, id: string, output?: string) {
  const blocks: unknown[] = [
    { type: 'text', text: 'Here is my plan.' },
    { type: 'tool_use', tool_call_id: TOOL_ID },
  ]
  if (output) blocks.push({ type: 'text', text: 'Plan approved, building.' })
  return {
    id,
    session_id: sessionId,
    role: 'assistant',
    content: output
      ? 'Here is my plan.\nPlan approved, building.'
      : 'Here is my plan.',
    content_blocks: blocks,
    timestamp: now - 60,
    tool_calls: [planTool(output)],
  }
}

// The current flow: the plan ended the turn, the session waits for approval.
const waiting = createSession({ name: 'Waiting plan', order: 0 })
waiting.messages = [
  userMessage(waiting.id, 'Plan the settings field.'),
  planMessage(waiting.id, `${waiting.id}-a0`),
]
Object.assign(waiting, {
  backend: 'claude',
  execution_mode: 'plan',
  waiting_for_input: true,
  waiting_for_input_type: 'plan',
  last_run_status: 'completed',
})

// A client that loads the session while the run log still says running.
const running = createSession({ name: 'Running plan', order: 1 })
running.messages = [
  userMessage(running.id, 'Plan the settings field.'),
  planMessage(running.id, 'running-run-e2e-plan'),
]
Object.assign(running, {
  backend: 'claude',
  execution_mode: 'plan',
  waiting_for_input: true,
  waiting_for_input_type: 'plan',
  last_run_status: 'running',
})

// 1.6.0/1.6.1: the parked plan call timed out; the session still waits.
const timedOut = createSession({ name: 'Timed-out plan', order: 2 })
timedOut.messages = [
  userMessage(timedOut.id, 'Plan the settings field.'),
  {
    ...planMessage(timedOut.id, `${timedOut.id}-a0`),
    tool_calls: [planTool('Timed out waiting for the user to respond.')],
  },
]
Object.assign(timedOut, {
  backend: 'claude',
  execution_mode: 'plan',
  waiting_for_input: true,
  waiting_for_input_type: 'plan',
  last_run_status: 'completed',
})

// 1.6.0/1.6.1: the plan was approved inside its own turn.
const inTurn = createSession({ name: 'In-turn plan', order: 3 })
inTurn.messages = [
  userMessage(inTurn.id, 'Plan the settings field.'),
  planMessage(
    inTurn.id,
    `${inTurn.id}-a0`,
    'User has approved your plan. You can now start coding.'
  ),
]
Object.assign(inTurn, {
  backend: 'claude',
  execution_mode: 'build',
  last_run_status: 'completed',
})

// A session to which the plan arrives live.
const live = createSession({ name: 'Live plan', order: 4 })
Object.assign(live, { backend: 'claude', execution_mode: 'plan' })

const worktree = createWorktree(project.id, {
  name: 'plan-buttons',
  path: '/tmp/e2e-plan-buttons/.worktrees/plan-buttons',
  sessions: [waiting, running, timedOut, inTurn, live],
})

const overrides = {
  list_projects: [project],
  list_worktrees: [worktree],
  load_preferences: { ...mockPreferences, zoom_level: 100 },
  load_ui_state: {
    ...mockUIState,
    active_project_id: project.id,
    expanded_project_ids: [project.id],
  },
}

/**
 * The chat view is a per-device preference (localStorage), not the host's
 * `load_preferences`. Set it, then reload so the app reads it.
 */
async function useView(page: Page, view: 'normal' | 'compact') {
  await page.evaluate(compact => {
    localStorage.setItem(
      'jean-client-preferences-v1',
      JSON.stringify({ compact_chat_view_enabled: compact })
    )
  }, view === 'compact')
  await page.reload()
}

const shotDir = process.env.PLAN_BUTTONS_SCREENSHOT_DIR
const stamp = process.env.PLAN_BUTTONS_SCREENSHOT_STAMP ?? 'local'

async function openTab(page: Page, id: string) {
  await page.locator(`[data-session-id="${id}"]`).first().click()
  await page.waitForTimeout(500)
}

function planButtons(page: Page) {
  const modal = page.getByTestId('session-chat-modal-swipe')
  return {
    approve: modal.getByRole('button', { name: /^Approve$/ }),
    yolo: modal.getByRole('button', { name: /^YOLO$/ }),
  }
}

test.use({
  viewport: { width: 1280, height: 800 },
  responseOverrides: overrides,
})

async function expectButtons(page: Page) {
  const modal = page.getByTestId('session-chat-modal-swipe')
  await expect(modal.getByText('Write the tests')).toBeVisible()
  const { approve, yolo } = planButtons(page)
  await expect(approve).toHaveCount(1)
  await expect(yolo).toHaveCount(1)
  await expect(approve).toBeVisible()
}

for (const view of ['normal', 'compact'] as const) {
  test.describe(`${view} view`, () => {
    for (const target of [waiting, running, timedOut]) {
      test(`${target.name}: buttons at the end of the plan box`, async ({
        mockPage: page,
      }) => {
        await useView(page, view)
        await activateWorktree(page, 'plan-buttons')
        // As for a session started in this app run: the store knows it
        // runs on Claude.
        await page.evaluate(async id => {
          const { useChatStore } = await import('/src/store/chat-store.ts')
          useChatStore.getState().setSelectedBackend(id, 'claude')
        }, target.id)
        await openTab(page, target.id)
        await expectButtons(page)
        // After a reload the store knows no backend for the session.
        await page.reload()
        await activateWorktree(page, 'plan-buttons')
        await openTab(page, target.id)
        await expectButtons(page)
        if (shotDir && target === waiting) {
          await page.screenshot({
            path: `${shotDir}/plan-buttons-${view}-${stamp}.png`,
          })
        }
      })
    }

    // The store knows no backend for the session, as after a restart.
    test('in-turn approved plan: no buttons', async ({ mockPage: page }) => {
      await useView(page, view)
      await activateWorktree(page, 'plan-buttons')
      await openTab(page, inTurn.id)
      const modal = page.getByTestId('session-chat-modal-swipe')
      await expect(modal.getByText('Plan approved, building.')).toBeVisible()
      const { approve, yolo } = planButtons(page)
      await expect(approve).toHaveCount(0)
      await expect(yolo).toHaveCount(0)
    })

    test('a plan that arrives live shows the buttons when the turn ends', async ({
      mockPage: page,
      emitEvent,
    }) => {
      await useView(page, view)
      await activateWorktree(page, 'plan-buttons')
      await openTab(page, live.id)
      // Like the backend: once the run has ended, the session holds the turn
      // and waits for plan approval.
      await page.evaluate(
        ({ sessionId, messages }) => {
          const w = window as any
          const mock = w.__JEAN_E2E_MOCK__
          const original = mock.invokeHandlers.get_session
          mock.invokeHandlers.get_session = (args: { sessionId: string }) => {
            const session = original(args)
            if (args.sessionId === sessionId && w.__turnDone) {
              Object.assign(session, {
                messages: structuredClone(messages),
                waiting_for_input: true,
                waiting_for_input_type: 'plan',
              })
            }
            return session
          }
          mock.invokeHandlers.send_chat_message = () => new Promise(() => {})
        },
        {
          sessionId: live.id,
          messages: [
            userMessage(live.id, 'Plan the settings field.'),
            planMessage(live.id, `${live.id}-a0`),
          ],
        }
      )
      const textarea = page.locator('textarea').first()
      await textarea.fill('Plan the settings field.')
      await textarea.press('Enter')
      await page.waitForTimeout(300)

      const base = { session_id: live.id, worktree_id: worktree.id }
      await emitEvent('chat:sending', { ...base, user_message: 'x' })
      await emitEvent('chat:chunk', { ...base, content: 'Here is my plan.' })
      await emitEvent('chat:tool_use', { ...base, ...planTool() })
      await emitEvent('chat:tool_block', { ...base, tool_call_id: TOOL_ID })
      await page.evaluate(() => ((window as any).__turnDone = true))
      await emitEvent('chat:done', base)
      await expectButtons(page)
    })
  })
}

test.describe('approval', () => {
  for (const mode of ['build', 'yolo'] as const) {
    test(`${mode === 'build' ? 'Approve' : 'YOLO'} starts the next turn in ${mode} mode`, async ({
      mockPage: page,
    }) => {
      await useView(page, 'normal')
      await page.evaluate(() => {
        const w = window as any
        const mock = w.__JEAN_E2E_MOCK__
        const original = mock.invokeHandlers.send_chat_message
        w.__sent = []
        mock.invokeHandlers.send_chat_message = (args: unknown) => {
          w.__sent.push(args)
          return original(args)
        }
      })
      await activateWorktree(page, 'plan-buttons')
      await openTab(page, waiting.id)
      const { approve, yolo } = planButtons(page)
      await (mode === 'build' ? approve : yolo).click()
      await expect
        .poll(() => page.evaluate(() => (window as any).__sent.length))
        .toBe(1)
      const sent = await page.evaluate(() => (window as any).__sent[0])
      expect(sent.sessionId).toBe(waiting.id)
      expect(sent.executionMode).toBe(mode)
      expect(sent.message).toMatch(/plan/i)
    })
  }
})
