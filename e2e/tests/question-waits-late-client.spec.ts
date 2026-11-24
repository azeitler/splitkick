import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * A client that opens after a Claude question was asked gets no event for
 * it: it has only the saved session. A yolo session that waits on its
 * question must show as waiting there, with the question open, and not as
 * the red "Yoloing" spinner (#159).
 */

const TOOL_ID = 'toolu_e2e_late_client'
const now = Math.floor(Date.now() / 1000)

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Yolo run with a question', order: 0 })
session.messages = [
  {
    id: 'u-1',
    session_id: session.id,
    role: 'user',
    content: 'Tidy up the sample tree',
    timestamp: now - 120,
    tool_calls: [],
  },
  {
    id: 'a-1',
    session_id: session.id,
    role: 'assistant',
    content: '',
    content_blocks: [{ type: 'tool_use', tool_call_id: TOOL_ID }],
    timestamp: now - 100,
    tool_calls: [
      {
        id: TOOL_ID,
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Which sample folder goes first?',
              header: 'Order',
              multiSelect: false,
              options: [
                { label: 'Docs', description: 'The docs folder' },
                { label: 'Tests', description: 'The tests folder' },
              ],
            },
          ],
        },
      },
    ],
  },
]
// What the host saves when the turn ends at the question.
Object.assign(session, {
  backend: 'claude',
  selected_execution_mode: 'yolo',
  last_run_status: 'completed',
  last_run_execution_mode: 'yolo',
  waiting_for_input: true,
  waiting_for_input_type: 'question',
})

const worktree = createWorktree(project.id, {
  name: 'late-client',
  path: '/tmp/e2e-late-client/.worktrees/late-client',
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

test('a client that opens later shows the waiting question, not a running session', async ({
  mockPage: page,
}) => {
  await activateWorktree(page, 'late-client')
  const row = page.locator(`[data-session-id="${session.id}"]`).first()
  const dot = row.getByRole('img').first()

  await expect(dot).toHaveAttribute('aria-label', 'Input required')
  await expect(dot).not.toHaveClass(/animate-spin/)
  await expect(page.getByRole('img', { name: 'Yoloing' })).toHaveCount(0)

  await row.click()
  const modal = page.getByTestId('session-chat-modal-swipe')
  await expect(
    modal.getByRole('button', { name: /^Answer(?!ed)/ })
  ).toHaveCount(1)
  await expect(modal.getByTestId('streaming-status-bar')).toHaveCount(0)
})
