import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import type { Locator, Page } from '@playwright/test'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * A Claude question ends its turn; the answer starts the next one. The chat
 * must keep that order on screen: the question (answered), then the answer
 * as the user's message, then the reply. Each is drawn once: while the reply
 * streams, after the run, and after the stored session loads again, in the
 * normal and the compact view.
 */

const QUESTION = 'Which sample step comes next?'
const QUESTION_ID = 'toolu_e2e_end_turn_question'
const ANSWER_MESSAGE = `Answer to your question "${QUESTION}": Ship`
const INTRO = 'I checked the sample. One decision is open.'
const REPLY = 'Shipped the sample as you chose.'
const now = Math.floor(Date.now() / 1000)

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Question turn', order: 0 })
Object.assign(session, {
  backend: 'claude',
  last_run_status: 'completed',
  selected_execution_mode: 'yolo',
})
const other = createSession({ name: 'Other', order: 1 })

const worktree = createWorktree(project.id, {
  name: 'order-tree',
  path: '/tmp/e2e-question-order/.worktrees/order-tree',
  sessions: [session, other],
})

const command = {
  id: 'toolu_e2e_end_turn_cmd',
  name: 'Bash',
  input: { command: 'echo sample', description: 'Sample step' },
}
const questionTool = {
  id: QUESTION_ID,
  name: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: QUESTION,
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

// The turn that ended at the question, as the backend stores it: the
// question has no tool result.
const questionTurn = [
  {
    id: 'u-1',
    session_id: session.id,
    role: 'user',
    content: 'Run the sample task',
    timestamp: now - 120,
    tool_calls: [],
  },
  {
    id: 'a-1',
    session_id: session.id,
    role: 'assistant',
    content: INTRO,
    timestamp: now - 100,
    content_blocks: [
      { type: 'tool_use', tool_call_id: command.id },
      { type: 'text', text: INTRO },
      { type: 'tool_use', tool_call_id: QUESTION_ID },
    ],
    tool_calls: [{ ...command, output: 'sample' }, questionTool],
  },
]
// The next turn: the answer as a new message, then the reply.
const answerTurn = [
  {
    id: 'u-2',
    session_id: session.id,
    role: 'user',
    content: ANSWER_MESSAGE,
    timestamp: now - 60,
    tool_calls: [],
  },
  {
    id: 'a-2',
    session_id: session.id,
    role: 'assistant',
    content: REPLY,
    timestamp: now - 50,
    content_blocks: [{ type: 'text', text: REPLY }],
    tool_calls: [],
  },
]

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

async function openTab(page: Page, id: string) {
  await page.locator(`[data-session-id="${id}"]`).first().click()
  await page.waitForTimeout(300)
}

async function top(locator: Locator): Promise<number> {
  await expect(locator).toHaveCount(1)
  await expect(locator).toBeVisible()
  return (await locator.boundingBox())!.y
}

/** Question (answered), then the answer message, then the reply. */
async function expectAnswerAndReplyBelowQuestion(modal: Locator) {
  const question = await top(modal.getByTestId('question-status-icon'))
  const answer = await top(modal.getByText(ANSWER_MESSAGE, { exact: true }))
  const reply = await top(modal.getByText(REPLY, { exact: true }))
  expect(answer).toBeGreaterThan(question)
  expect(reply).toBeGreaterThan(answer)
  // The answered question takes no second answer.
  await expect(
    modal.getByRole('button', { name: /^Answer(?!ed)/ })
  ).toHaveCount(0)
}

for (const view of ['normal', 'compact'] as const) {
  test.describe(`${view} view`, () => {
    test.use({ responseOverrides: overrides(view === 'compact') })

    test('question, answer and reply keep their order live, after the run and after a reload', async ({
      mockPage: page,
      emitEvent,
    }) => {
      await activateWorktree(page, 'order-tree')
      await openTab(page, session.id)
      const modal = page.getByTestId('session-chat-modal-swipe')

      await page.evaluate(
        ({ sessionId, questionTurn, answerTurn, toolId }) => {
          const w = window as any
          const mock = w.__JEAN_E2E_MOCK__
          w.__stage = 0
          w.__sent = []
          // The disk holds a turn only once its run has ended.
          const original = mock.invokeHandlers.get_session
          mock.invokeHandlers.get_session = (args: { sessionId: string }) => {
            const result = original(args)
            if (args.sessionId !== sessionId || w.__stage === 0) return result
            const answered = w.__stage === 2
            return {
              ...result,
              messages: structuredClone(
                answered ? [...questionTurn, ...answerTurn] : questionTurn
              ),
              last_run_status: 'completed',
              waiting_for_input: !answered,
              waiting_for_input_type: answered ? null : 'question',
              answered_questions: answered ? [toolId] : [],
            }
          }
          // Resolves when the run ends; the test ends first.
          mock.invokeHandlers.send_chat_message = (args: {
            message: string
          }) => {
            w.__sent.push(args.message)
            return new Promise(() => {})
          }
        },
        {
          sessionId: session.id,
          questionTurn,
          answerTurn,
          toolId: QUESTION_ID,
        }
      )
      const textarea = page.locator('textarea').first()
      await textarea.fill('Run the sample task')
      await textarea.press('Enter')
      await page.waitForTimeout(300)

      // Turn 1: a step, a note, then the question. The turn ends there.
      const base = { session_id: session.id, worktree_id: worktree.id }
      await emitEvent('chat:sending', { ...base, user_message: 'x' })
      await emitEvent('chat:tool_use', { ...base, ...command })
      await emitEvent('chat:tool_block', { ...base, tool_call_id: command.id })
      await emitEvent('chat:tool_result', {
        ...base,
        tool_use_id: command.id,
        output: 'sample',
      })
      await emitEvent('chat:chunk', { ...base, content: INTRO })
      await emitEvent('chat:tool_use', { ...base, ...questionTool })
      await emitEvent('chat:tool_block', { ...base, tool_call_id: QUESTION_ID })
      await page.evaluate(() => ((window as any).__stage = 1))
      await emitEvent('chat:done', base)
      await page.waitForTimeout(800)

      // One open question, below the prompt; nothing runs.
      const answerButton = modal.getByRole('button', { name: /^Answer(?!ed)/ })
      await expect(answerButton).toHaveCount(1)
      const prompt = await top(
        modal.getByText('Run the sample task', { exact: true })
      )
      expect((await answerButton.boundingBox())!.y).toBeGreaterThan(prompt)
      await expect(modal.getByTestId('streaming-status-bar')).toHaveCount(0)

      // The answer goes out as a new message that names the question.
      await modal.getByRole('radio', { name: /Ship/ }).click()
      await answerButton.click()
      await expect
        .poll(() => page.evaluate(() => (window as any).__sent.at(-1)))
        .toBe(ANSWER_MESSAGE)

      // Turn 2: the reply streams below the answer.
      await emitEvent('chat:sending', { ...base, user_message: ANSWER_MESSAGE })
      await emitEvent('chat:chunk', { ...base, content: REPLY })
      await expectAnswerAndReplyBelowQuestion(modal)

      await page.evaluate(() => ((window as any).__stage = 2))
      await emitEvent('chat:done', base)
      await page.waitForTimeout(800)
      await expectAnswerAndReplyBelowQuestion(modal)

      await openTab(page, other.id)
      await openTab(page, session.id)
      await expectAnswerAndReplyBelowQuestion(modal)
    })
  })
}
