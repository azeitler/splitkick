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
 * The reply after a question answered in the same turn is drawn (#154).
 *
 * Since #136 a Claude run answers AskUserQuestion in its own turn: the answer
 * comes back as the tool result, more tools run, and the turn ends with its
 * reply text. The reply must show in full after the question: after the run
 * ends and when the stored session loads again, in the normal and the
 * compact view. Live, the normal view draws it after the tools; the compact
 * view shows it as its activity line.
 */

const REPLY_DETAIL = 'Here is the sample summary.'
const REPLY = `All shipped.\n\n${REPLY_DETAIL}`
const QUESTION_ID = 'toolu_e2e_in_turn_question'
const now = Math.floor(Date.now() / 1000)

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'In-turn question', order: 0 })
Object.assign(session, { backend: 'claude', last_run_status: 'completed' })
const other = createSession({ name: 'Other', order: 1 })

const worktree = createWorktree(project.id, {
  name: 'question-tree',
  path: '/tmp/e2e-in-turn-question/.worktrees/question-tree',
  sessions: [session, other],
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
const ANSWER = 'The user answered: "Which sample step comes next?"="Ship".'
const commands = ['toolu_e2e_cmd_1', 'toolu_e2e_cmd_2'].map((id, i) => ({
  id,
  name: 'Bash',
  input: {
    command: `echo sample-${i + 1}`,
    description: `Sample step ${i + 1}`,
  },
}))

// The stored turn, as the backend returns it after the run.
const storedMessages = [
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
    content: REPLY,
    timestamp: now - 60,
    content_blocks: [
      { type: 'tool_use', tool_call_id: commands[0]!.id },
      { type: 'tool_use', tool_call_id: QUESTION_ID },
      { type: 'tool_use', tool_call_id: commands[1]!.id },
      { type: 'text', text: REPLY },
    ],
    tool_calls: [
      { ...commands[0], output: 'sample-1' },
      { ...questionTool, output: ANSWER },
      { ...commands[1], output: 'sample-2' },
    ],
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

/** The full reply is visible, drawn once, and below the answered question. */
async function expectReplyAfterQuestion(modal: Locator) {
  const reply = modal.getByText(REPLY_DETAIL, { exact: true })
  await expect(reply).toHaveCount(1)
  await expect(reply).toBeVisible()
  const question = modal.getByTestId('question-status-icon')
  await expect(question).toHaveCount(1)
  const replyBox = await reply.boundingBox()
  const questionBox = await question.boundingBox()
  expect(replyBox!.y).toBeGreaterThan(questionBox!.y)
}

for (const view of ['normal', 'compact'] as const) {
  test.describe(`${view} view`, () => {
    test.use({ responseOverrides: overrides(view === 'compact') })

    test('the reply after an in-turn question shows live, after the run and after a reload', async ({
      mockPage: page,
      emitEvent,
    }) => {
      await activateWorktree(page, 'question-tree')
      await openTab(page, session.id)
      const modal = page.getByTestId('session-chat-modal-swipe')

      await page.evaluate(
        ({ sessionId, messages }) => {
          const w = window as any
          const mock = w.__JEAN_E2E_MOCK__
          // The disk holds the run only once the turn has ended.
          const original = mock.invokeHandlers.get_session
          mock.invokeHandlers.get_session = (args: { sessionId: string }) => {
            const result = original(args)
            if (args.sessionId === sessionId && w.__turnDone) {
              result.messages = structuredClone(messages)
            }
            return result
          }
          // Resolves when the run ends; the test ends first.
          mock.invokeHandlers.send_chat_message = () => new Promise(() => {})
        },
        { sessionId: session.id, messages: storedMessages }
      )
      const textarea = page.locator('textarea').first()
      await textarea.fill('Run the sample task')
      await textarea.press('Enter')
      await page.waitForTimeout(300)

      const base = { session_id: session.id, worktree_id: worktree.id }
      await emitEvent('chat:sending', { ...base, user_message: 'x' })
      const runTool = async (
        tool: { id: string; name: string; input: unknown },
        output: string
      ) => {
        await emitEvent('chat:tool_use', { ...base, ...tool })
        await emitEvent('chat:tool_block', { ...base, tool_call_id: tool.id })
        await emitEvent('chat:tool_result', {
          ...base,
          tool_use_id: tool.id,
          output,
        })
      }
      await runTool(commands[0]!, 'sample-1')
      await emitEvent('chat:tool_use', { ...base, ...questionTool })
      await emitEvent('chat:tool_block', { ...base, tool_call_id: QUESTION_ID })
      // The user answers in the chat; the answer returns as the tool result.
      await page.evaluate(
        async ({ sessionId, toolId }) => {
          const { useChatStore } = await import('/src/store/chat-store.ts')
          useChatStore
            .getState()
            .markQuestionAnswered(sessionId, toolId, [
              { questionIndex: 0, selectedOptions: [0] },
            ])
        },
        { sessionId: session.id, toolId: QUESTION_ID }
      )
      await emitEvent('chat:tool_result', {
        ...base,
        tool_use_id: QUESTION_ID,
        output: ANSWER,
      })
      await runTool(commands[1]!, 'sample-2')
      await emitEvent('chat:chunk', { ...base, content: REPLY })

      if (view === 'normal') {
        await expectReplyAfterQuestion(modal)
      } else {
        await expect(modal.getByText(REPLY_DETAIL).first()).toBeVisible()
      }

      await page.evaluate(() => ((window as any).__turnDone = true))
      await emitEvent('chat:done', base)
      await page.waitForTimeout(800)
      await expectReplyAfterQuestion(modal)

      await openTab(page, other.id)
      await openTab(page, session.id)
      await expectReplyAfterQuestion(modal)
    })
  })
}
