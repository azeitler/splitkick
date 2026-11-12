import type { Locator, Page } from '@playwright/test'
import { test, expect, activateWorktree, MOD } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * The in-chat find bar in a long chat: the view stays on the current match
 * while a turn streams, and the bar state (query, current match) is per
 * session.
 */

const TOPICS = [
  'Retry the billing webhook with exponential backoff.',
  'The invoice export now streams rows instead of buffering them.',
  'Add a test for the webhook signature check.',
  'Move the rate limiter in front of the public API.',
  'Log the webhook delivery id with every retry.',
  'The onboarding email links to the new pricing page.',
]

function longChat(sessionId: string, pairs: number) {
  const base = Math.floor(Date.now() / 1000) - pairs * 120
  return Array.from({ length: pairs * 2 }, (_, i) => {
    const user = i % 2 === 0
    const topic = TOPICS[Math.floor(i / 2) % TOPICS.length]
    const content = user
      ? `Step ${Math.floor(i / 2) + 1}: ${topic}`
      : `Done. ${topic}\n\nI checked the change against the existing tests and the staging logs. Nothing else needs to move for this step.`
    return {
      id: `${sessionId}-m${i}`,
      session_id: sessionId,
      role: user ? 'user' : 'assistant',
      content,
      content_blocks: user ? undefined : [{ type: 'text', text: content }],
      timestamp: base + i * 60,
      tool_calls: [],
    }
  })
}

const project = createProject({ name: 'Billing Service' })
const sessionA = createSession({ name: 'Webhook retries', order: 0 })
const sessionB = createSession({ name: 'Invoice export', order: 1 })
sessionA.messages = longChat(sessionA.id, 30)
sessionB.messages = longChat(sessionB.id, 12)
const worktree = createWorktree(project.id, {
  name: 'webhook-retries',
  path: '/tmp/e2e-find-bar/.worktrees/webhook-retries',
  sessions: [sessionA, sessionB],
})

test.use({
  viewport: { width: 1280, height: 800 },
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    load_preferences: { ...mockPreferences, zoom_level: 100 },
    load_ui_state: {
      ...mockUIState,
      active_project_id: project.id,
      expanded_project_ids: [project.id],
    },
  },
})

const shotPath = process.env.FIND_BAR_SCREENSHOT_PATH

function findBar(page: Page): Locator {
  return page.locator('[data-chat-search-bar]')
}

function viewport(page: Page): Locator {
  return page
    .getByTestId('session-chat-modal-swipe')
    .locator('[data-slot="scroll-area-viewport"]', {
      has: page.locator('[data-message-anchor-id]'),
    })
    .first()
}

async function scrollTop(page: Page): Promise<number> {
  return viewport(page).evaluate(el => Math.round(el.scrollTop))
}

/** The current match is inside the visible part of the chat. */
async function activeMatchVisible(page: Page): Promise<boolean> {
  return viewport(page).evaluate(el => {
    const box = el.getBoundingClientRect()
    const counter = document
      .querySelector('[data-chat-search-bar] [aria-live]')
      ?.textContent?.split('/')
    const index = Number(counter?.[0] ?? 0) - 1
    const query = (
      document.querySelector('[data-chat-search-bar] input') as HTMLInputElement
    ).value.toLowerCase()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let seen = 0
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = node.textContent?.toLowerCase() ?? ''
      let at = text.indexOf(query)
      while (at !== -1) {
        if (seen === index) {
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + query.length)
          const r = range.getBoundingClientRect()
          return r.top >= box.top && r.bottom <= box.bottom
        }
        seen += 1
        at = text.indexOf(query, at + 1)
      }
    }
    return false
  })
}

test('find bar stays on its match while a turn streams and is kept per session', async ({
  mockPage,
  emitEvent,
}) => {
  await activateWorktree(mockPage, 'webhook-retries')
  await mockPage.locator(`[data-session-id="${sessionA.id}"]`).first().click()
  await expect(
    mockPage.getByText('Step 30: The onboarding email').first()
  ).toBeVisible({ timeout: 5000 })

  // Open, search, step back to an older match.
  await mockPage.keyboard.press(`${MOD}+f`)
  const input = findBar(mockPage).getByPlaceholder('Find in chat...')
  await expect(input).toBeFocused()
  await input.fill('webhook')
  const counter = findBar(mockPage).locator('[aria-live]')
  await expect(counter).toHaveText(/^\d+\/\d+$/)
  // The first match can sit near the top and load older messages; the bar
  // keeps that match, so wait until the counter settles.
  let settled = ''
  await expect
    .poll(
      async () => {
        const now = (await counter.textContent()) ?? ''
        const same = now === settled
        settled = now
        return same
      },
      { intervals: [400] }
    )
    .toBe(true)
  const [start, total] = settled.split('/').map(Number)
  expect(total).toBeGreaterThan(4)
  for (let i = 0; i < 3; i++) {
    await input.press('Shift+Enter')
    await mockPage.waitForTimeout(150)
  }
  const expected = ((start - 1 - 3 + total) % total) + 1
  await expect(counter).toHaveText(`${expected}/${total}`)
  await expect.poll(() => activeMatchVisible(mockPage)).toBe(true)
  const top = await scrollTop(mockPage)

  // A turn streams in this session: the view and the match stay put.
  await emitEvent('chat:sending', {
    session_id: sessionA.id,
    worktree_id: worktree.id,
  })
  for (const chunk of [
    'Checking the webhook ',
    'retry queue now. ',
    'The webhook backoff is capped at five minutes.',
  ]) {
    await emitEvent('chat:chunk', { session_id: sessionA.id, content: chunk })
    await mockPage.waitForTimeout(250)
  }
  await expect
    .poll(() => mockPage.getByText('backoff is capped at five minutes').count())
    .toBeGreaterThan(0)
  await mockPage.waitForTimeout(400)
  await expect(counter).toHaveText(new RegExp(`^${expected}/\\d+$`))
  expect(Math.abs((await scrollTop(mockPage)) - top)).toBeLessThan(2)
  expect(await activeMatchVisible(mockPage)).toBe(true)
  await emitEvent('chat:done', {
    session_id: sessionA.id,
    worktree_id: worktree.id,
  })
  await mockPage.waitForTimeout(400)
  expect(Math.abs((await scrollTop(mockPage)) - top)).toBeLessThan(2)

  if (shotPath) {
    await mockPage
      .getByTestId('session-chat-modal-swipe')
      .screenshot({ path: shotPath })
  }

  // Stepping moves only to the next match.
  const before = await counter.textContent()
  await input.press('Enter')
  const [cur] = (before ?? '').split('/')
  await expect(counter).toHaveText(new RegExp(`^${Number(cur) + 1}/`))
  await expect.poll(() => activeMatchVisible(mockPage)).toBe(true)
  const restoredText = await counter.textContent()

  // Session B never opened the bar.
  await mockPage.locator(`[data-session-id="${sessionB.id}"]`).first().click()
  await expect(
    mockPage.getByText('Step 12: The onboarding email').first()
  ).toBeVisible({ timeout: 5000 })
  await expect(findBar(mockPage)).toHaveCount(0)

  // Back to A: same query, same current match, scrolled to it.
  await mockPage.locator(`[data-session-id="${sessionA.id}"]`).first().click()
  await expect(findBar(mockPage)).toBeVisible()
  await expect(input).toHaveValue('webhook')
  await expect(counter).toHaveText(restoredText ?? '')
  await expect.poll(() => activeMatchVisible(mockPage)).toBe(true)

  // Esc closes and clears this session's bar.
  await input.press('Escape')
  await expect(findBar(mockPage)).toHaveCount(0)
  await mockPage.keyboard.press(`${MOD}+f`)
  await expect(input).toHaveValue('')
})
