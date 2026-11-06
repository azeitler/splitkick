import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

test('MCP add_artifact fills the Artifacts tab (#107)', async ({ page }) => {
  const { a, alphaA } = readEnv()
  const name = uniqueName('Artifacts')
  await createSession(a, alphaA, name)
  const out = join(alphaA.worktreePath, 'e2e-out')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'report.html'), '<h1>E2E report page</h1>')
  writeFileSync(join(out, 'notes.md'), 'E2E notes file')

  await openApp(page, a)
  await goToSession(page, name)
  await send(
    page,
    [
      'STUB:mcp add_artifact {"title":"E2E report","target":"e2e-out/report.html","note":"Generated page"}',
      'STUB:mcp add_artifact {"title":"E2E notes","target":"e2e-out/notes.md"}',
      'STUB:mcp add_artifact {"title":"E2E preview","target":"https://example.com/e2e-preview"}',
    ].join('\n')
  )

  await expect(page.getByTestId('artifacts-badge')).toHaveText('3')
  await page.getByRole('button', { name: /^Artifacts \(/ }).click()
  await expect(page.getByTestId('context-panel-tab-artifacts')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(page.getByTestId('artifacts-tab-count')).toHaveText('3')
  const list = page.getByRole('list', { name: 'Artifacts' })
  await expect(list).toContainText('E2E report')
  await expect(list).toContainText('Generated page')
  // The relative target was stored as a path inside the worktree, and is
  // shown relative to it.
  await expect(list).toContainText('e2e-out/report.html')
  await expect(
    list.locator(`[title="${join(out, 'report.html')}"]`)
  ).toBeVisible()
  await shot(page, 'artifacts-tab')

  // HTML opens in the sandboxed preview of the file viewer.
  await list.getByText('E2E report', { exact: true }).click()
  const frame = page.locator('iframe[sandbox]')
  await expect(frame).toBeVisible()
  await expect(
    frame.contentFrame().getByRole('heading', { name: 'E2E report page' })
  ).toBeVisible()
  // The file viewer closes only from its X (no ESC, by design).
  const closeViewer = () =>
    page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await closeViewer()
  await expect(frame).toBeHidden()

  // Another file opens in the file viewer.
  await list.getByText('E2E notes', { exact: true }).click()
  await expect(page.getByText('E2E notes file')).toBeVisible()
  await closeViewer()

  // Web Access has no in-app browser: a URL opens in a new tab.
  const popup = page.waitForEvent('popup')
  await list.getByText('E2E preview', { exact: true }).click()
  await expect(await popup).toHaveURL('https://example.com/e2e-preview')

  await list.getByRole('button', { name: 'Remove E2E notes' }).click()
  await expect(page.getByTestId('artifacts-badge')).toHaveText('2')

  await page.reload()
  await goToSession(page, name)
  await expect(page.getByTestId('artifacts-badge')).toHaveText('2')
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
