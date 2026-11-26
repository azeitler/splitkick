import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import type { Page } from '@playwright/test'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * A client that misses the `chat:done` event of a run (#163).
 *
 * The run ends on the host, but this client never hears of it: the session
 * stayed "running", the timer kept counting and the next message went into
 * the queue. The client now asks the host which sessions run
 * (`list_sending_sessions`) when the window gets focus, and clears a mark
 * the host does not confirm.
 *
 * Web mode is the harness default. Desktop mode uses the switch from
 * queue-send-now-desktop.spec.ts (see there for why).
 */

const FIRST = 'First sample task'
const SECOND = 'Second sample task'

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Missed done', order: 0 })
Object.assign(session, { backend: 'claude', last_run_status: 'completed' })
const worktree = createWorktree(project.id, {
  name: 'missed-done',
  path: '/tmp/e2e-missed-done/.worktrees/missed-done',
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
 * A host whose first run ends without a `chat:done` reaching this client.
 * Later sends end at once, like a short run.
 */
async function hostThatLosesDone(page: Page) {
  await page.evaluate(
    ({ sid, wid }) => {
      const w = window as any
      const mock = w.__JEAN_E2E_MOCK__
      const emit = (event: string, payload: unknown) =>
        mock.eventEmitter.dispatchEvent(
          new CustomEvent(event, { detail: payload })
        )
      const calls: string[] = (w.__calls = [])
      const host = (w.__host = { running: false, sends: 0 })
      const reply = (content: string) => ({
        id: `a-${Date.now()}`,
        session_id: sid,
        role: 'assistant',
        content,
        content_blocks: [],
        timestamp: Math.floor(Date.now() / 1000),
        tool_calls: [],
        cancelled: false,
      })
      const on = (name: string, fn: (args: any) => unknown) => {
        mock.invokeHandlers[name] = (args: any) => {
          calls.push(name)
          return fn(args)
        }
      }
      on('list_sending_sessions', () => (host.running ? [sid] : []))
      on('enqueue_message', args => [args.message])
      on('send_chat_message', args => {
        if (host.running)
          throw new Error('Session already has an active request')
        host.sends += 1
        host.running = true
        emit('chat:sending', {
          session_id: sid,
          worktree_id: wid,
          user_message: args.message,
        })
        return new Promise(resolve =>
          setTimeout(() => {
            host.running = false
            // The first run's chat:done never reaches this client.
            if (host.sends > 1) {
              emit('chat:done', { session_id: sid, worktree_id: wid })
            }
            resolve(reply('Done'))
          }, 300)
        )
      })
    },
    { sid: session.id, wid: worktree.id }
  )
}

const calls = (page: Page) =>
  page.evaluate(() => (window as any).__calls as string[])

for (const mode of ['web', 'desktop'] as const) {
  test(`${mode}: a missed chat:done is healed when the window gets focus`, async ({
    mockPage: page,
  }) => {
    await activateWorktree(page, 'missed-done')
    await page.locator(`[data-session-id="${session.id}"]`).first().click()
    if (mode === 'desktop') await desktopMode(page)
    await hostThatLosesDone(page)

    const modal = page.getByTestId('session-chat-modal-swipe')
    const timer = modal.getByTestId('streaming-status-bar')
    const input = page.locator('textarea').first()
    await input.fill(FIRST)
    await input.press('Enter')
    await expect(timer).toBeVisible()

    // The run ended on the host; this client still shows it as running.
    await expect
      .poll(() => page.evaluate(() => (window as any).__host.running))
      .toBe(false)
    await page.waitForTimeout(300)
    await expect(timer).toBeVisible()

    // Make the send older than the guard for a send that just started.
    await page.evaluate(async sessionId => {
      const { useChatStore } = await import(
        '/src/store/chat-store.ts' as string
      )
      useChatStore.setState((s: any) => ({
        sendStartedAt: { ...s.sendStartedAt, [sessionId]: Date.now() - 60_000 },
      }))
    }, session.id)

    await page.evaluate(() => window.dispatchEvent(new Event('focus')))

    await expect(timer).toHaveCount(0)
    expect(
      await page.evaluate(async () => {
        const { useChatStore } = await import(
          '/src/store/chat-store.ts' as string
        )
        return useChatStore.getState().sendingSessionIds
      })
    ).toEqual({})

    // The next message is sent directly, not queued.
    await input.fill(SECOND)
    await input.press('Enter')
    await expect
      .poll(async () =>
        (await calls(page)).filter(c => c === 'send_chat_message')
      )
      .toHaveLength(2)
    expect(await calls(page)).not.toContain('enqueue_message')
  })
}
