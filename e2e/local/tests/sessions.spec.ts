import { expect, test } from '@playwright/test'
import { createSession, readEnv } from '../helpers'
import { goToSession, openApp, send, shot, uniqueName } from './ui'

// The stub CLI turns `STUB:` lines into replies and real Splitkick MCP calls
// made as the sending session (see e2e/local/stub-claude.mjs).

test('session link resolves to its session (#44)', async ({ page }) => {
  const { a, alphaA } = readEnv()
  const linker = uniqueName('Linker')
  const target = uniqueName('Link target')
  await createSession(a, alphaA, linker)
  const targetId = await createSession(a, alphaA, target)

  await openApp(page, a)
  await goToSession(page, linker)
  await send(
    page,
    [
      // Agents write links as markdown; a link whose text is the URL shows
      // the session's name.
      `STUB:say See [splitkick://session/${targetId}](splitkick://session/${targetId})`,
      'STUB:say Missing [gone](splitkick://session/00000000-0000-0000-0000-000000000000)',
    ].join('\n')
  )

  const link = page.locator('a[data-chat-link]').filter({ hasText: target })
  await expect(link).toBeVisible()
  await expect(
    page.locator('a[data-chat-link]').filter({ hasText: 'not found' })
  ).toBeVisible()
  await link.hover()
  await expect(page.getByRole('tooltip')).toContainText(
    `alpha › feature-a › ${target}`
  )
  await shot(page, 'session-link')

  await link.click()
  await expect(page.getByText(target, { exact: true }).first()).toBeVisible()
})

test('MCP add_follow_up fills the follow-up list (#46)', async ({ page }) => {
  const { a, alphaA } = readEnv()
  const name = uniqueName('Follow-ups')
  await createSession(a, alphaA, name)

  await openApp(page, a)
  await goToSession(page, name)
  await send(page, 'STUB:mcp add_follow_up {"text":"E2E follow-up"}')

  const button = page.getByRole('button', { name: /^Follow-ups/ })
  await expect(page.getByTestId('follow-ups-badge')).toHaveText('1')
  await button.click()
  const panel = page.getByLabel('Follow-up items')
  await expect(panel).toContainText('E2E follow-up')

  await page.getByLabel('New follow-up').fill('Added by hand')
  await page.getByLabel('New follow-up').press('Enter')
  await expect(page.getByTestId('follow-ups-badge')).toHaveText('2')
  await shot(page, 'follow-ups')

  await panel.getByRole('checkbox', { name: 'Mark as done' }).first().click()
  await expect(page.getByTestId('follow-ups-badge')).toHaveText('1')

  await page.reload()
  await goToSession(page, name)
  await expect(page.getByTestId('follow-ups-badge')).toHaveText('1')
})

test('MCP send keeps executionMode and links both sessions (#61, #62)', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const parent = uniqueName('Parent')
  const target = uniqueName('Yolo target')
  const child = uniqueName('Child')
  await createSession(a, alphaA, parent)
  const targetId = await createSession(a, alphaA, target)

  await openApp(page, a)
  // A first turn of its own: a later MCP send is then "Sent to", not
  // "Started" (the first send into a fresh session records its parent).
  await goToSession(page, target)
  expect(await send(page, 'First turn')).toContain('mode=plan')

  await goToSession(page, parent)
  await send(
    page,
    [
      `STUB:mcp send_chat_message {"sessionId":"${targetId}","message":"Hi from parent","executionMode":"yolo"}`,
      `STUB:mcp create_session {"worktreeId":"${alphaA.worktreeId}","name":"${child}"}`,
    ].join('\n')
  )

  // Parent: one insert per session it reached.
  await expect(page.getByText(`Sent to session ‘${target}’`)).toBeVisible()
  await expect(page.getByText(`Started session ‘${child}’`)).toBeVisible()
  await shot(page, 'parent-inserts')

  // #61: the target ran in Yolo and keeps the mode.
  await goToSession(page, target)
  await expect(page.getByText('STUB REPLY mode=yolo').first()).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('button', { name: /Yolo/ }).first()).toBeVisible()
  await shot(page, 'mcp-yolo-target')
  await page.reload()
  await goToSession(page, target)
  await expect(page.getByRole('button', { name: /Yolo/ }).first()).toBeVisible()

  // #62: the child names its parent and links back.
  await goToSession(page, child)
  await expect(page.getByText(`Started by ‘${parent}’`)).toBeVisible()
  await shot(page, 'child-banner')
})
