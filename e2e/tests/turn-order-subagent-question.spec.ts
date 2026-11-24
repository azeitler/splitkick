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
 * A turn draws its blocks in turn order: a sub-agent with its own step,
 * main-thread steps, a note, a question answered in the turn, more steps and
 * the reply. The main-thread steps stay out of the finished sub-agent, and
 * the note stays above the question.
 */

const NOTE = 'Reading the sample reviews now.'
const REPLY_DETAIL = 'Here is the sample summary.'
const REPLY = `All sample checks are done.\n\n${REPLY_DETAIL}`
const now = Math.floor(Date.now() / 1000)

const project = createProject({ name: 'Acme' })
const session = createSession({ name: 'Turn order', order: 0 })
const other = createSession({ name: 'Other', order: 1 })
const tool = (
  id: string,
  name: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  name,
  input: {},
  output: 'ok',
  ...extra,
})
session.messages = [
  {
    id: 'u-1',
    session_id: session.id,
    role: 'user',
    content: 'Check the sample',
    timestamp: now - 600,
    tool_calls: [],
  },
  {
    id: 'a-1',
    session_id: session.id,
    role: 'assistant',
    content: `${NOTE}${REPLY}`,
    timestamp: now - 60,
    content_blocks: [
      { type: 'tool_use', tool_call_id: 'agent-1' },
      { type: 'tool_use', tool_call_id: 'sub-1' },
      { type: 'tool_use', tool_call_id: 'main-1' },
      { type: 'tool_use', tool_call_id: 'main-2' },
      { type: 'tool_use', tool_call_id: 'main-3' },
      { type: 'text', text: NOTE },
      { type: 'tool_use', tool_call_id: 'main-4' },
      { type: 'tool_use', tool_call_id: 'q-1' },
      { type: 'tool_use', tool_call_id: 'main-5' },
      { type: 'tool_use', tool_call_id: 'main-6' },
      { type: 'text', text: REPLY },
    ],
    tool_calls: [
      tool('agent-1', 'Agent', {
        input: { description: 'Read a sample page', prompt: 'Read it' },
      }),
      tool('sub-1', 'WebFetch', { parent_tool_use_id: 'agent-1' }),
      tool('main-1', 'ToolSearch'),
      tool('main-2', 'mcp__playwright__browser_navigate'),
      tool('main-3', 'mcp__playwright__browser_evaluate'),
      tool('main-4', 'mcp__playwright__browser_evaluate'),
      tool('q-1', 'AskUserQuestion', {
        input: {
          questions: [
            {
              question: 'Which sample fits?',
              header: 'Sample',
              multiSelect: false,
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        },
        output: 'The user answered: A',
      }),
      tool('main-5', 'WebSearch'),
      tool('main-6', 'Bash', { input: { command: 'echo sample' } }),
    ],
  },
]
Object.assign(session, { backend: 'claude', last_run_status: 'completed' })

const worktree = createWorktree(project.id, {
  name: 'order-tree',
  path: '/tmp/e2e-turn-order/.worktrees/order-tree',
  sessions: [session, other],
})

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

test.use({ viewport: { width: 1280, height: 1000 } })

async function openTab(page: Page, id: string) {
  await page.locator(`[data-session-id="${id}"]`).first().click()
  await page.waitForTimeout(300)
}

async function y(locator: Locator): Promise<number> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  return box?.y ?? -1
}

for (const view of ['normal', 'compact'] as const) {
  test.describe(`${view} view`, () => {
    test.use({ responseOverrides: overrides(view === 'compact') })

    test('a turn with a sub-agent and an in-turn question keeps its order', async ({
      mockPage: page,
    }) => {
      await activateWorktree(page, 'order-tree')
      const modal = page.getByTestId('session-chat-modal-swipe')

      for (const pass of ['open', 'reload'] as const) {
        if (pass === 'reload') await openTab(page, other.id)
        await openTab(page, session.id)

        const question = modal.getByTestId('question-status-icon')
        const reply = modal.getByText(REPLY_DETAIL, { exact: true })
        await expect(reply).toHaveCount(1)
        expect(await y(question)).toBeLessThan(await y(reply))

        if (view === 'normal') {
          // The sub-agent holds only its own step.
          const agent = modal.getByText('Read a sample page')
          await expect(modal.getByText('1 tool', { exact: true })).toBeVisible()
          // The note stays in place, between the steps and the question.
          const note = modal.getByText(NOTE, { exact: true })
          expect(await y(agent)).toBeLessThan(await y(note))
          expect(await y(note)).toBeLessThan(await y(question))
        }
      }
    })
  })
}
