import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import type { Page } from '@playwright/test'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * The message queue in the desktop app.
 *
 * The harness runs the web client by default, and there the backend alone
 * drains the queue: the client's own queue processor is off. So the desktop
 * path had no e2e test. These tests switch the client to desktop mode and
 * play the backend's part as recorded from a real run:
 * - a send while a run is active is refused ("already has an active request");
 * - `dequeue_message` answers null while the run is active (the queue is held);
 * - `cancel_chat_message` answers true for an active run and false for an
 *   idle session; after a cancel the backend sends the queue front itself.
 */

const FIRST = 'First long sample task'
const QUEUED = 'Queued sample follow-up'

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Queue session', order: 0 })
Object.assign(session, { backend: 'claude', last_run_status: 'completed' })
const worktree = createWorktree(project.id, {
  name: 'queue-desktop',
  path: '/tmp/e2e-queue-desktop/.worktrees/queue-desktop',
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
    // App reads the mode when it renders. Render it now, so its startup
    // effect for the new mode runs here and not in the middle of the test.
    const ui = (await import('/src/store/ui-store.ts' as string)).useUIStore
    ui.setState({ jeanMcpIntroOpen: true })
    await new Promise(r => setTimeout(r, 300))
    ui.setState({ jeanMcpIntroOpen: false })
  })
  await page.waitForTimeout(1500)
}

/** A backend that keeps a queue and one run, like the real one. */
async function fakeBackend(page: Page, noOutput = false) {
  await page.evaluate(
    ({ sid, wid, noOutput }) => {
      const w = window as any
      const mock = w.__JEAN_E2E_MOCK__
      const emit = (event: string, payload: unknown) =>
        mock.eventEmitter.dispatchEvent(
          new CustomEvent(event, { detail: payload })
        )
      const calls: string[] = (w.__calls = [])
      const be = {
        queue: [] as { id: string; message: string }[],
        running: false,
        endRun: null as null | ((v: unknown) => void),
        finalized: null as null | Promise<void>,
        lastMessage: '',
      }
      const reply = (cancelled: boolean, content: string) => ({
        id: `a-${Date.now()}`,
        session_id: sid,
        role: 'assistant',
        content,
        content_blocks: [],
        timestamp: Math.floor(Date.now() / 1000),
        tool_calls: [],
        cancelled,
      })
      const startRun = (message: string) => {
        be.running = true
        be.lastMessage = message
        emit('chat:sending', {
          session_id: sid,
          worktree_id: wid,
          user_message: message,
        })
        return new Promise(resolve => (be.endRun = resolve))
      }
      const queueChanged = () =>
        emit('queue:updated', { sessionId: sid, queue: [...be.queue] })
      const on = (name: string, fn: (args: any) => unknown) => {
        mock.invokeHandlers[name] = (args: any) => {
          calls.push(name)
          return fn(args)
        }
      }
      on('send_chat_message', args => {
        if (be.running) throw new Error('Session already has an active request')
        return startRun(args.message)
      })
      on('enqueue_message', args => {
        be.queue.push(args.message)
        queueChanged()
        return [...be.queue]
      })
      on('move_queued_message_front', args => {
        const index = be.queue.findIndex(m => m.id === args.messageId)
        if (index < 0) return false
        be.queue.unshift(be.queue.splice(index, 1)[0]!)
        queueChanged()
        return true
      })
      const dequeue = () => {
        if (be.running || be.queue.length === 0) return null
        const message = be.queue.shift()
        queueChanged()
        return message
      }
      on('dequeue_message', () => {
        // The real command waits for the session lock that the cancel holds
        // while it finalizes the run, so it can win right after that.
        if (be.finalized) return be.finalized.then(dequeue)
        return dequeue()
      })
      on('cancel_chat_message', () => {
        if (!be.running) return false
        const undone = be.lastMessage
        let finalize = () => {}
        if (noOutput) be.finalized = new Promise(r => (finalize = r))
        emit('chat:cancelled', {
          session_id: sid,
          worktree_id: wid,
          undo_send: false,
          emitted_at_ms: Date.now(),
          run_id: 'run-1',
        })
        setTimeout(() => {
          be.running = false
          if (noOutput) {
            // A run cancelled before any output: the backend finalizes it,
            // then drops the turn and says so. A dequeue can win in between.
            finalize()
            be.finalized = null
            setTimeout(() => {
              emit('chat:undo-send', {
                session_id: sid,
                worktree_id: wid,
                run_id: 'run-1',
                user_message: undone,
              })
              be.endRun?.(reply(true, ''))
            }, 150)
            return
          }
          be.endRun?.(reply(true, ''))
          // The backend drain: it sends the queue front itself.
          setTimeout(() => {
            const next = be.queue.shift()
            if (!next || be.running) return
            queueChanged()
            calls.push('backend-drain')
            startRun(next.message)
          }, 200)
        }, 300)
        return true
      })
    },
    { sid: session.id, wid: worktree.id, noOutput }
  )
}

const calls = (page: Page) =>
  page.evaluate(() => (window as any).__calls as string[])

async function openSessionAndQueue(page: Page, noOutput = false) {
  await activateWorktree(page, 'queue-desktop')
  await page.locator(`[data-session-id="${session.id}"]`).first().click()
  await desktopMode(page)
  await fakeBackend(page, noOutput)

  const input = page.locator('textarea').first()
  await input.fill(FIRST)
  await input.press('Enter')
  await page.waitForTimeout(500)
  await input.fill(QUEUED)
  await input.press('Enter')
  await expect(page.getByRole('button', { name: 'Send now' })).toHaveCount(1)
  return input
}

/**
 * Desktop mode shows toasts in this harness (zoom hint, a missing shell API)
 * that lie over the queue panel, so a pointer click would hit a toast.
 */
async function clickSendNow(page: Page) {
  await page
    .getByRole('button', { name: 'Send now' })
    .evaluate(button => (button as HTMLElement).click())
}

/** After "Send now": the run was cancelled and the queued message runs. */
async function expectQueuedMessageSent(page: Page) {
  await expect
    .poll(() => calls(page), { timeout: 5000 })
    .toContain('cancel_chat_message')
  await expect(page.getByRole('button', { name: 'Send now' })).toHaveCount(0)
  // The queued message is the running turn now: once, in the chat.
  const modal = page.getByTestId('session-chat-modal-swipe')
  await expect(modal.getByText(QUEUED)).toHaveCount(1)
  const sends = (await calls(page)).filter(
    c => c === 'backend-drain' || c === 'send_chat_message'
  )
  // The first message, and the queued one exactly once (by the backend drain
  // or by this client's queue processor, never both).
  expect(sends).toHaveLength(2)
}

test('a message sent while a run is active goes into the queue', async ({
  mockPage: page,
}) => {
  const input = await openSessionAndQueue(page)

  expect(await calls(page)).toEqual(['send_chat_message', 'enqueue_message'])
  // It is in the queue panel, not back in the input.
  await expect(input).toHaveValue('')
})

test('"Send now" cancels the run and sends the queued message', async ({
  mockPage: page,
}) => {
  const input = await openSessionAndQueue(page)

  await clickSendNow(page)

  await expectQueuedMessageSent(page)
  await expect(input).toHaveValue('')
})

test('"Send now" works when this client lost the running state', async ({
  mockPage: page,
}) => {
  const input = await openSessionAndQueue(page)
  // A missed event, or a run that was started elsewhere: the client believes
  // the session is idle. Before, "Send now" then did nothing.
  await page.evaluate(async () => {
    const chat = (await import('/src/store/chat-store.ts' as string))
      .useChatStore
    chat.setState({ sendingSessionIds: {} })
  })

  await clickSendNow(page)

  await expectQueuedMessageSent(page)
  await expect(input).toHaveValue('')
})

test('"Send now" works when the store has no worktree for the session', async ({
  mockPage: page,
}) => {
  const input = await openSessionAndQueue(page)
  // Before, every queue action then returned without doing anything.
  await page.evaluate(async () => {
    const chat = (await import('/src/store/chat-store.ts' as string))
      .useChatStore
    chat.setState({ sessionWorktreeMap: {}, worktreePaths: {} })
  })

  await clickSendNow(page)

  await expectQueuedMessageSent(page)
  await expect(input).toHaveValue('')
})

test('"Send now" before the run has output: the queued message is sent, not put back into the input', async ({
  mockPage: page,
}) => {
  const input = await openSessionAndQueue(page, true)

  await clickSendNow(page)

  await expect
    .poll(() => calls(page), { timeout: 5000 })
    .toContain('cancel_chat_message')
  const modal = page.getByTestId('session-chat-modal-swipe')
  await expect(modal.getByText(QUEUED)).toHaveCount(1)
  await page.waitForTimeout(1000)
  // The undone turn is the first message. The queued one was sent: it must
  // not come back into the input, and it must stay in the chat.
  await expect(input).toHaveValue('')
  await expect(modal.getByText(QUEUED)).toHaveCount(1)
})
