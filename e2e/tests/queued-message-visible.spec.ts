import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * A queued message stays in the chat while its run works.
 *
 * The session has a cancelled turn in its history. The backend drains the
 * queue and starts the next run; a refetch reads the session before the
 * backend has written that run (the mock `get_session` keeps returning the
 * history without it). The message must stay visible while the
 * run streams and after it ends.
 */

const QUEUED = 'Queued follow-up for the sample task'
const REPLY = 'Working on the queued follow-up.'
const now = Math.floor(Date.now() / 1000)

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Long session', order: 0 })

function message(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    session_id: session.id,
    role,
    content,
    timestamp: now - 300,
    tool_calls: [],
    ...extra,
  }
}

session.messages = [
  message('u-1', 'user', 'First sample prompt'),
  message('a-1', 'assistant', 'Stopped sample answer', { cancelled: true }),
  message('u-2', 'user', 'Second sample prompt'),
  message('a-2', 'assistant', 'Second sample answer'),
]
Object.assign(session, { backend: 'claude', last_run_status: 'completed' })

const worktree = createWorktree(project.id, {
  name: 'queue-tree',
  path: '/tmp/e2e-queued-message/.worktrees/queue-tree',
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

test('a queued message stays visible while its run works', async ({
  mockPage: page,
  emitEvent,
}) => {
  await activateWorktree(page, 'queue-tree')
  await page.locator(`[data-session-id="${session.id}"]`).first().click()
  const modal = page.getByTestId('session-chat-modal-swipe')
  await expect(modal.getByText('Second sample answer')).toBeVisible()

  await page.evaluate(
    ({ sessionId, done }) => {
      const w = window as any
      const mock = w.__JEAN_E2E_MOCK__
      // The disk holds the new run only once the turn has ended.
      const original = mock.invokeHandlers.get_session
      mock.invokeHandlers.get_session = (args: { sessionId: string }) => {
        const result = original(args)
        if (args.sessionId === sessionId && w.__turnDone) {
          result.messages = [...result.messages, ...structuredClone(done)]
        }
        return result
      }
    },
    {
      sessionId: session.id,
      done: [
        message('u-3', 'user', QUEUED),
        message('a-3', 'assistant', REPLY),
      ],
    }
  )

  // The backend drains the queue: it starts the run and tells every client.
  const base = { session_id: session.id, worktree_id: worktree.id }
  await emitEvent('chat:sending', { ...base, user_message: QUEUED })
  await expect(modal.getByText(QUEUED)).toBeVisible()
  // Another session's change refetches every open session before this run
  // is on disk.
  await emitEvent('cache:invalidate', { keys: ['sessions'] })
  await page.waitForTimeout(800)
  await emitEvent('chat:chunk', { ...base, content: REPLY })

  await expect(modal.getByText(REPLY)).toBeVisible()
  await expect(modal.getByText(QUEUED)).toBeVisible()

  await page.evaluate(() => ((window as any).__turnDone = true))
  await emitEvent('chat:done', base)
  await page.waitForTimeout(800)
  await expect(modal.getByText(QUEUED)).toBeVisible()
  await expect(modal.getByText(REPLY)).toBeVisible()
})
