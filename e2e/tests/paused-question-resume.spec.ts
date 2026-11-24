import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * A Claude question ends its turn. The card stays open while the session
 * waits, and the answer starts the next turn as a new message that names the
 * question.
 */

const QUESTION = 'Which sample color fits?'
const TOOL_ID = 'toolu_e2e_paused_question'
const now = Math.floor(Date.now() / 1000)

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Paused question', order: 0 })
session.messages = [
  {
    id: 'u-1',
    session_id: session.id,
    role: 'user',
    content: 'Pick a color for the sample',
    timestamp: now - 900,
    tool_calls: [],
  },
  {
    id: 'a-1',
    session_id: session.id,
    role: 'assistant',
    content: '',
    content_blocks: [{ type: 'tool_use', tool_call_id: TOOL_ID }],
    timestamp: now - 880,
    tool_calls: [
      {
        id: TOOL_ID,
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: QUESTION,
              header: 'Color',
              multiSelect: false,
              options: [
                { label: 'Teal', description: 'Calm' },
                { label: 'Amber', description: 'Warm' },
              ],
            },
          ],
        },
      },
    ],
  },
]
Object.assign(session, {
  backend: 'claude',
  waiting_for_input: true,
  waiting_for_input_type: 'question',
  last_run_status: 'completed',
})

const worktree = createWorktree(project.id, {
  name: 'paused-tree',
  path: '/tmp/e2e-paused-question/.worktrees/paused-tree',
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

test('the answer to a waiting question resumes the session as a new message', async ({
  mockPage: page,
}) => {
  await activateWorktree(page, 'paused-tree')
  await page.locator(`[data-session-id="${session.id}"]`).first().click()
  const modal = page.getByTestId('session-chat-modal-swipe')

  await page.evaluate(() => {
    const w = window as any
    w.__sent = []
    // The turn ended at the question. The answer goes as a new message.
    w.__JEAN_E2E_MOCK__.invokeHandlers.send_chat_message = (args: unknown) => {
      w.__sent.push(args)
      return new Promise(() => {})
    }
  })

  await modal.getByRole('radio', { name: /Teal/ }).click()
  await modal.getByRole('button', { name: /^Answer(?!ed)/ }).click()

  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__sent.map((a: any) => a.message))
    )
    .toEqual([`Answer to your question "${QUESTION}": Teal`])
  await expect(
    modal.getByRole('button', { name: /^Answer(?!ed)/ })
  ).toHaveCount(0)
})
