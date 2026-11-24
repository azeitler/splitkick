import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * A client that opens (or reconnects) while a live yolo run waits on its
 * question missed `claude:dialog-waiting`. Before the fix it showed the run
 * as "Yoloing" (red spinner) until the question was answered; now it asks
 * the host for the parked dialogs and shows the session as waiting.
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
]
Object.assign(session, {
  backend: 'claude',
  selected_execution_mode: 'yolo',
  last_run_status: 'running',
  last_run_execution_mode: 'yolo',
  waiting_for_input: false,
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
    list_parked_claude_dialogs: [
      { sessionId: session.id, toolUseId: TOOL_ID, kind: 'question' },
    ],
    load_ui_state: {
      ...mockUIState,
      active_project_id: project.id,
      expanded_project_ids: [project.id],
    },
  },
})

test('a client that missed the question shows the run as waiting, not running', async ({
  mockPage: page,
}) => {
  await activateWorktree(page, 'late-client')
  const dot = page
    .locator(`[data-session-id="${session.id}"]`)
    .first()
    .getByRole('img')
    .first()

  await expect(dot).toHaveAttribute('aria-label', 'Waiting')
  await expect(dot).not.toHaveClass(/border-t-destructive/)
})
