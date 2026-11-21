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
 * One AskUserQuestion draws exactly one form (#146): when the session opens,
 * after a switch to another session and back, when the question arrives live,
 * and when the next turn runs while the streaming copy still holds the
 * answered question.
 */

const QUESTION = 'Which scope must an agent have?'
const TOOL_ID = 'toolu_e2e_question'
const now = Math.floor(Date.now() / 1000)

const project = createProject({ name: 'Splitkick' })

const questionTool = {
  id: TOOL_ID,
  name: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: QUESTION,
        header: 'Scope',
        multiSelect: false,
        options: [
          { label: 'Project', description: 'One project' },
          { label: 'Global', description: 'All projects' },
        ],
      },
    ],
  },
}

function userMessage(sessionId: string, id: string, text: string) {
  return {
    id,
    session_id: sessionId,
    role: 'user',
    content: text,
    timestamp: now - 120,
    tool_calls: [],
  }
}

function questionMessage(sessionId: string, id: string) {
  return {
    id,
    session_id: sessionId,
    role: 'assistant',
    content: 'I need one answer first.',
    content_blocks: [
      { type: 'text', text: 'I need one answer first.' },
      { type: 'tool_use', tool_call_id: TOOL_ID },
    ],
    timestamp: now - 60,
    tool_calls: [questionTool],
  }
}

// A turn that waits on its question: the backend returns the running
// placeholder `running-<run id>` that holds the turn so far.
const running = createSession({ name: 'Running question', order: 0 })
running.messages = [
  userMessage(running.id, `${running.id}-u0`, 'How do agents work?'),
  questionMessage(running.id, 'running-run-e2e'),
]
Object.assign(running, {
  backend: 'claude',
  waiting_for_input: true,
  waiting_for_input_type: 'question',
  last_run_status: 'running',
})

// The usual Claude case: the turn ended on its question.
const completed = createSession({ name: 'Completed question', order: 1 })
completed.messages = [
  userMessage(completed.id, `${completed.id}-u0`, 'How do agents work?'),
  questionMessage(completed.id, `${completed.id}-a0`),
]
Object.assign(completed, {
  backend: 'claude',
  waiting_for_input: true,
  waiting_for_input_type: 'question',
  last_run_status: 'completed',
})

const other = createSession({ name: 'Other', order: 2 })

const worktree = createWorktree(project.id, {
  name: 'agents-tab',
  path: '/tmp/e2e-question-once/.worktrees/agents-tab',
  sessions: [running, completed, other],
})

function overrides(compact: boolean) {
  return {
    list_projects: [project],
    list_worktrees: [worktree],
    load_preferences: {
      ...mockPreferences,
      zoom_level: 100,
      compact_chat_view_enabled: compact,
    },
    load_ui_state: {
      ...mockUIState,
      active_project_id: project.id,
      expanded_project_ids: [project.id],
    },
  }
}

test.use({
  viewport: { width: 1280, height: 800 },
  responseOverrides: overrides(false),
})

const shotDir = process.env.QUESTION_ONCE_SCREENSHOT_DIR
const stamp = process.env.QUESTION_ONCE_SCREENSHOT_STAMP ?? 'local'

/** Open forms (with an Answer button) and answered rows ("Answered …"). */
async function forms(page: Page) {
  // Let late effects (snapshot hydration, refetches) settle.
  await page.waitForTimeout(500)
  const modal = page.getByTestId('session-chat-modal-swipe')
  return {
    open: await modal.getByRole('button', { name: /^Answer(?!ed)/ }).count(),
    answered: await modal.getByRole('button', { name: /^Answered/ }).count(),
  }
}

async function openTab(page: Page, id: string) {
  await page.locator(`[data-session-id="${id}"]`).first().click()
  await page.waitForTimeout(300)
}

for (const target of [running, completed]) {
  test(`${target.name}: one form on open and after a switch`, async ({
    mockPage: page,
  }) => {
    await activateWorktree(page, 'agents-tab')
    await openTab(page, target.id)
    expect(await forms(page)).toEqual({ open: 1, answered: 0 })
    await openTab(page, other.id)
    await openTab(page, target.id)
    expect(await forms(page)).toEqual({ open: 1, answered: 0 })
  })
}

test('a question that arrives live draws one form', async ({
  mockPage: page,
  emitEvent,
}) => {
  await activateWorktree(page, 'agents-tab')
  await openTab(page, other.id)
  // Like the backend: the run log holds the turn once the run has ended.
  await page.evaluate(
    ({ sessionId, messages }) => {
      const w = window as any
      const mock = w.__JEAN_E2E_MOCK__
      const original = mock.invokeHandlers.get_session
      mock.invokeHandlers.get_session = (args: { sessionId: string }) => {
        const session = original(args)
        if (args.sessionId === sessionId && w.__turnDone) {
          session.messages = structuredClone(messages)
        }
        return session
      }
      // Resolves when the run ends; the test ends first.
      mock.invokeHandlers.send_chat_message = () => new Promise(() => {})
    },
    {
      sessionId: other.id,
      messages: [
        userMessage(other.id, `${other.id}-u0`, 'How do agents work?'),
        questionMessage(other.id, `${other.id}-a0`),
      ],
    }
  )
  const textarea = page.locator('textarea').first()
  await textarea.fill('How do agents work?')
  await textarea.press('Enter')
  await page.waitForTimeout(300)

  const base = { session_id: other.id, worktree_id: worktree.id }
  await emitEvent('chat:sending', { ...base, user_message: 'x' })
  await emitEvent('chat:chunk', {
    ...base,
    content: 'I need one answer first.',
  })
  await emitEvent('chat:tool_use', { ...base, ...questionTool })
  await emitEvent('chat:tool_block', { ...base, tool_call_id: TOOL_ID })
  expect(await forms(page)).toEqual({ open: 1, answered: 0 })

  await page.evaluate(() => ((window as any).__turnDone = true))
  await emitEvent('chat:done', base)
  expect(await forms(page)).toEqual({ open: 1, answered: 0 })

  await openTab(page, running.id)
  await openTab(page, other.id)
  expect(await forms(page)).toEqual({ open: 1, answered: 0 })
})

for (const view of ['normal', 'compact'] as const) {
  test.describe(`${view} view`, () => {
    test.use({ responseOverrides: overrides(view === 'compact') })

    test('the next turn does not draw the answered question again', async ({
      mockPage: page,
    }) => {
      await activateWorktree(page, 'agents-tab')
      await openTab(page, other.id)
      // The answered question is saved; the next turn runs, and its streaming
      // copy still holds that question (e.g. hydrated from a stale snapshot).
      await page.evaluate(
        async ({ id, messages, tool, toolId }) => {
          const { queryClient } = await import('/src/lib/query-client.ts')
          const { useChatStore } = await import('/src/store/chat-store.ts')
          queryClient.setQueryData(['chat', 'session', id], (old: any) => ({
            ...old,
            messages,
          }))
          const store = useChatStore.getState()
          store.addSendingSession(id)
          store.addToolCall(id, tool)
          store.addTextBlock(id, 'I need one answer first.')
          store.addToolBlock(id, toolId)
          store.addTextBlock(id, 'Thanks, going on.')
        },
        {
          id: other.id,
          tool: questionTool,
          toolId: TOOL_ID,
          messages: [
            userMessage(other.id, `${other.id}-u0`, 'How do agents work?'),
            questionMessage(other.id, `${other.id}-a0`),
            userMessage(
              other.id,
              `${other.id}-u1`,
              `For "${QUESTION}", I selected:\n- Global`
            ),
          ],
        }
      )

      const modal = page.getByTestId('session-chat-modal-swipe')
      await expect(modal.getByText('Thanks, going on.')).toBeVisible()
      if (shotDir) {
        await page.screenshot({
          path: `${shotDir}/question-next-turn-${view}-${stamp}.png`,
        })
      }
      expect(await forms(page)).toEqual({ open: 0, answered: 1 })
    })
  })
}
