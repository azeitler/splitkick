import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import type { Page } from '@playwright/test'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * The prompt outbox: a prompt the user submitted is never lost.
 *
 * Each test runs in the web client (Web Access, the harness default) and in
 * the desktop app (`desktopMode`, as in queue-send-now-desktop.spec.ts: the
 * desktop client runs its own queue processor). The mock backend plays the
 * failures: a send whose response is lost, an enqueue that fails, a reload
 * before any answer.
 */

const PROMPT = 'Sample prompt that must not get lost'
const QUEUED = 'Sample follow-up while the run is active'

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Outbox session', order: 0 })
Object.assign(session, { backend: 'claude', last_run_status: 'completed' })
const worktree = createWorktree(project.id, {
  name: 'outbox-wt',
  path: '/tmp/e2e-prompt-outbox/.worktrees/outbox-wt',
  sessions: [session],
})

test.use({
  viewport: { width: 1280, height: 800 },
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    load_ui_state: {
      ...mockUIState,
      active_project_id: project.id,
      expanded_project_ids: [project.id],
    },
  },
})

type Mode = 'web' | 'desktop'

/** Make the loaded client the desktop app talking to its local backend. */
async function desktopMode(page: Page) {
  await page.evaluate(async () => {
    const w = window as any
    w.__TAURI_INTERNALS__ = {
      invoke: async () => null,
      transformCallback: () => 0,
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
    }
    const ui = (await import('/src/store/ui-store.ts' as string)).useUIStore
    ui.setState({ jeanMcpIntroOpen: true })
    await new Promise(r => setTimeout(r, 300))
    ui.setState({ jeanMcpIntroOpen: false })
  })
  await page.waitForTimeout(1500)
}

/**
 * The backend's answers. `send`: 'ok' answers at once, 'hang' never answers
 * (a run, or a request lost on the way), 'disconnect' fails like a dropped
 * socket, 'error-later' fails after a delay. Sends emit chat:sending like the
 * real backend, except 'hang-silent' and 'disconnect'.
 */
async function fakeBackend(
  page: Page,
  opts: {
    send: 'ok' | 'hang' | 'hang-silent' | 'disconnect' | 'error-later'
    enqueueFails?: boolean
  }
) {
  await page.evaluate(
    ({ sid, wid, opts }) => {
      const w = window as any
      const mock = w.__JEAN_E2E_MOCK__
      const emit = (event: string, payload: unknown) =>
        mock.eventEmitter.dispatchEvent(
          new CustomEvent(event, { detail: payload })
        )
      const calls: string[] = (w.__calls = [])
      const on = (name: string, fn: (args: any) => unknown) => {
        mock.invokeHandlers[name] = (args: any) => {
          calls.push(name)
          return fn(args)
        }
      }
      on('send_chat_message', async args => {
        if (opts.send === 'disconnect')
          throw new Error('WebSocket disconnected')
        if (opts.send === 'error-later') {
          await new Promise(r => setTimeout(r, 1500))
          throw new Error('Worktree folder is not readable')
        }
        if (opts.send !== 'hang-silent') {
          emit('chat:sending', {
            session_id: sid,
            worktree_id: wid,
            user_message: args.message,
          })
        }
        if (opts.send === 'hang' || opts.send === 'hang-silent') {
          return new Promise(() => undefined)
        }
        return {
          id: `a-${Date.now()}`,
          session_id: sid,
          role: 'assistant',
          content: 'Done',
          content_blocks: [{ type: 'text', text: 'Done' }],
          timestamp: Math.floor(Date.now() / 1000),
          tool_calls: [],
          cancelled: false,
        }
      })
      on('enqueue_message', () => {
        if (opts.enqueueFails) throw new Error('WebSocket disconnected')
        return []
      })
      // The run of the first message is still active, so the queue is held.
      on('dequeue_message', () => null)
    },
    { sid: session.id, wid: worktree.id, opts }
  )
}

async function openSession(page: Page, mode: Mode) {
  await activateWorktree(page, 'outbox-wt')
  await page.locator(`[data-session-id="${session.id}"]`).first().click()
  if (mode === 'desktop') await desktopMode(page)
  const input = page.locator('textarea').first()
  await expect(input).toBeVisible()
  return input
}

const calls = (page: Page) =>
  page.evaluate(() => ((window as any).__calls ?? []) as string[])

const outboxEntries = (page: Page) =>
  page.evaluate(() =>
    Object.values(
      JSON.parse(localStorage.getItem('jean:prompt-outbox:v1') ?? '{}')
    ).map((e: any) => ({ text: e.text, status: e.status }))
  )

for (const mode of ['web', 'desktop'] as const) {
  test.describe(`prompt outbox (${mode})`, () => {
    test('a send whose response is lost comes back into the input', async ({
      mockPage: page,
    }) => {
      const input = await openSession(page, mode)
      await fakeBackend(page, { send: 'disconnect' })

      await input.fill(PROMPT)
      await input.press('Enter')

      // Before, a dropped socket only refetched the session: the prompt was
      // gone from the input and the backend never got it.
      await expect(input).toHaveValue(PROMPT, { timeout: 5000 })
    })

    test('a failed send while the user types anew shows as unsent', async ({
      mockPage: page,
    }) => {
      const input = await openSession(page, mode)
      await fakeBackend(page, { send: 'error-later' })

      await input.fill(PROMPT)
      await input.press('Enter')
      await expect(input).toHaveValue('')
      await input.fill('Something new')

      const item = page.getByTestId('unsent-prompt')
      await expect(item).toBeVisible({ timeout: 5000 })
      await expect(item).toContainText(PROMPT)
      await expect(input).toHaveValue('Something new')

      // "Edit" moves it into the input, below the new text.
      await item.getByRole('button', { name: 'Edit' }).click()
      await expect(input).toHaveValue(
        new RegExp(`Something new[\\s\\S]*${PROMPT}`)
      )
      await expect(item).toHaveCount(0)
    })

    test('a message sent during a run is not lost when the enqueue fails', async ({
      mockPage: page,
    }) => {
      const input = await openSession(page, mode)
      await fakeBackend(page, { send: 'hang', enqueueFails: true })

      await input.fill(PROMPT)
      await input.press('Enter')
      await page.waitForTimeout(500)
      await input.fill(QUEUED)
      await input.press('Enter')

      await expect
        .poll(() => calls(page), { timeout: 5000 })
        .toContain('enqueue_message')
      // Before, the failed enqueue was only logged: the prompt lived in this
      // client's queue copy until the next queue:updated or reload.
      await expect(input).toHaveValue(QUEUED, { timeout: 5000 })
      await expect(page.getByRole('button', { name: 'Send now' })).toHaveCount(
        0
      )
    })

    test('a prompt submitted right before a reload is offered again', async ({
      mockPage: page,
    }) => {
      const input = await openSession(page, mode)
      await fakeBackend(page, { send: 'hang-silent' })

      await input.fill(PROMPT)
      await input.press('Enter')
      await expect(input).toHaveValue('')
      await expect
        .poll(() => outboxEntries(page))
        .toEqual([{ text: PROMPT, status: 'pending' }])

      await page.reload()
      const again = await openSession(page, mode)

      await expect(again).toHaveValue(PROMPT, { timeout: 8000 })
    })

    test('a send the backend accepted is not restored (no duplicate)', async ({
      mockPage: page,
    }) => {
      const input = await openSession(page, mode)
      await fakeBackend(page, { send: 'hang' })

      await input.fill(PROMPT)
      await input.press('Enter')
      await expect.poll(() => calls(page)).toContain('send_chat_message')

      // chat:sending confirmed it: nothing is left in the outbox.
      await expect.poll(() => outboxEntries(page)).toEqual([])
      await page.reload()
      const again = await openSession(page, mode)
      await page.waitForTimeout(1500)
      await expect(again).toHaveValue('')
      await expect(page.getByTestId('unsent-prompt')).toHaveCount(0)
    })

    test('the offline indicator shows and hides', async ({
      mockPage: page,
    }) => {
      const input = await openSession(page, mode)
      const setOffline = (offline: boolean) =>
        page.evaluate(value => {
          const mock = (window as any).__JEAN_E2E_MOCK__
          mock.offline = value
          mock.eventEmitter.dispatchEvent(new CustomEvent('e2e:connection'))
        }, offline)

      const indicator = page.getByTestId('offline-indicator')
      await expect(indicator).toHaveCount(0)

      await setOffline(true)
      await expect(indicator).toBeVisible()
      await expect(indicator).toHaveText('Offline. Reconnecting…')

      // A submit while offline is kept and says so.
      await fakeBackend(page, { send: 'hang-silent' })
      await input.fill(PROMPT)
      await input.press('Enter')
      await expect(page.getByTestId('outbox-waiting')).toBeVisible()

      await setOffline(false)
      await expect(indicator).toHaveCount(0)
    })
  })
}
