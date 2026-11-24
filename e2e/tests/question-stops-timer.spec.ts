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
 * A streamed question that waits inside a live run (OpenCode, Codex) stops
 * the running timer and the activity spinner: nothing runs while the user
 * decides. After the answer the run works again, and so do they.
 */

const QUESTION_ID = 'toolu_e2e_timer_question'
const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Timer question', order: 0 })
Object.assign(session, { backend: 'claude', last_run_status: 'completed' })
const worktree = createWorktree(project.id, {
  name: 'timer-tree',
  path: '/tmp/e2e-question-timer/.worktrees/timer-tree',
  sessions: [session],
})

const questionTool = {
  id: QUESTION_ID,
  name: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: 'Which sample step comes next?',
        header: 'Next',
        multiSelect: false,
        options: [
          { label: 'Ship', description: 'Ship the sample' },
          { label: 'Wait', description: 'Wait a day' },
        ],
      },
    ],
  },
}
const command = {
  id: 'toolu_e2e_timer_cmd',
  name: 'Bash',
  input: { command: 'echo sample', description: 'Sample step' },
}

function overrides(compact: boolean) {
  return {
    list_projects: [project],
    list_worktrees: [worktree],
    load_preferences: {
      ...mockPreferences,
      compact_chat_view_enabled: compact,
    },
    load_ui_state: {
      ...mockUIState,
      active_project_id: project.id,
      expanded_project_ids: [project.id],
    },
  }
}

test.use({ viewport: { width: 1280, height: 800 } })

async function startRun(page: Page) {
  await activateWorktree(page, 'timer-tree')
  await page.locator(`[data-session-id="${session.id}"]`).first().click()
  await page.evaluate(() => {
    const mock = (window as any).__JEAN_E2E_MOCK__
    // Resolves when the run ends; the test ends first.
    mock.invokeHandlers.send_chat_message = () => new Promise(() => {})
  })
  const textarea = page.locator('textarea').first()
  await textarea.fill('Run the sample task')
  await textarea.press('Enter')
  await page.waitForTimeout(300)
}

for (const view of ['normal', 'compact'] as const) {
  test.describe(`${view} view`, () => {
    test.use({ responseOverrides: overrides(view === 'compact') })

    test('no running timer or spinner while a question waits', async ({
      mockPage: page,
      emitEvent,
    }) => {
      await startRun(page)
      const modal = page.getByTestId('session-chat-modal-swipe')
      const base = { session_id: session.id, worktree_id: worktree.id }

      await emitEvent('chat:sending', { ...base, user_message: 'x' })
      await emitEvent('chat:tool_use', { ...base, ...command })
      await emitEvent('chat:tool_block', { ...base, tool_call_id: command.id })
      await emitEvent('chat:tool_result', {
        ...base,
        tool_use_id: command.id,
        output: 'sample',
      })
      const timer = modal.getByTestId('streaming-status-bar')
      await expect(timer).toBeVisible()

      // The run waits on the question.
      await emitEvent('chat:tool_use', { ...base, ...questionTool })
      await emitEvent('chat:tool_block', { ...base, tool_call_id: QUESTION_ID })
      // The backend's request event marks the session as waiting.
      await page.evaluate(async sessionId => {
        const { useChatStore } = await import('/src/store/chat-store.ts')
        useChatStore.getState().setWaitingForInput(sessionId, true)
      }, session.id)
      await expect(modal.getByRole('button', { name: /^Answer/ })).toBeVisible()
      await expect(timer).toHaveCount(0)
      await expect(modal.locator('.animate-spin')).toHaveCount(0)

      // Answered in the turn: the run works again.
      await page.evaluate(
        async ({ sessionId, toolId }) => {
          const { useChatStore } = await import('/src/store/chat-store.ts')
          useChatStore
            .getState()
            .markQuestionAnswered(sessionId, toolId, [
              { questionIndex: 0, selectedOptions: [0] },
            ])
          useChatStore.getState().setWaitingForInput(sessionId, false)
        },
        { sessionId: session.id, toolId: QUESTION_ID }
      )
      await emitEvent('chat:tool_result', {
        ...base,
        tool_use_id: QUESTION_ID,
        output: 'The user answered: Ship',
      })
      await expect(timer).toBeVisible()
    })
  })
}
