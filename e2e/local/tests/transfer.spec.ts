import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { api, createSession, readEnv, waitForIdle } from '../helpers'
import {
  chatInput,
  goToSession,
  openApp,
  openSessionMenu,
  send,
  shot,
  uniqueName,
} from './ui'

// 1×1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function filesContaining(dir: string, marker: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .filter(path => readFileSync(path, 'utf8').includes(marker))
}

test('transfer A→B keeps history, pasted files and contexts (#35)', async ({
  page,
  browser,
}) => {
  const { a, b, alphaA } = readEnv()
  const name = uniqueName('Transfer me')
  const sessionId = await createSession(a, alphaA, name)

  await openApp(page, a, [
    { id: 'b', name: 'Instance B', url: b.url, token: b.token },
  ])
  await goToSession(page, name)

  // Turn 1: plain history.
  expect(await send(page, 'Remember E2E-SECRET-HISTORY')).toContain(
    'E2E-SECRET-HISTORY'
  )

  // Turn 2: a long pasted text (becomes a pasted-text file) and an image.
  await chatInput(page).evaluate((input, png) => {
    const data = new DataTransfer()
    const text = `E2E-SECRET-PASTE\n${'pasted line\n'.repeat(250)}`
    data.setData('text/plain', text)
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    )
    const image = new DataTransfer()
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0))
    image.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }))
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: image,
        bubbles: true,
        cancelable: true,
      })
    )
  }, PNG_BASE64)
  await expect(page.getByText(/^paste-/)).toBeVisible()
  await expect
    .poll(() => readdirSync(join(a.data, 'pasted-images')).length)
    .toBeGreaterThan(0)
  await shot(page, 'transfer-a-attachments')
  expect(await send(page, 'Here are the files')).toContain('E2E-SECRET-PASTE')

  // A saved context attached to the session.
  await api(a, 'save_context_file', {
    worktreePath: 'alpha',
    slug: 'e2e-context',
    content: '# Saved context\n\nE2E-SECRET-CONTEXT\n',
  })
  const { contexts } = await api<{
    contexts: { path: string; slug: string }[]
  }>(a, 'list_saved_contexts')
  const saved = contexts.find(context => context.slug === 'e2e-context')
  expect(saved).toBeTruthy()
  await api(a, 'attach_saved_context', {
    sessionId,
    worktreeId: alphaA.worktreeId,
    sourcePath: saved?.path,
    slug: 'e2e-context',
  })

  // Transfer through the real menu and dialog, once turn 2 is finished.
  await waitForIdle(a, sessionId)
  await openSessionMenu(page, name)
  await page.getByRole('menuitem', { name: /Transfer to Remote/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Worktree')).toContainText('feature-b')
  await shot(page, 'transfer-dialog')
  await dialog.getByRole('button', { name: 'Transfer' }).click()
  await expect(page.getByText('Session transferred to Instance B')).toBeVisible(
    {
      timeout: 60_000,
    }
  )
  await shot(page, 'transfer-done-on-a')

  // B has the session, its files and its context.
  expect(
    filesContaining(join(b.data, 'pasted-texts'), 'E2E-SECRET-PASTE')
  ).not.toHaveLength(0)
  expect(
    filesContaining(join(b.data, 'session-context'), 'E2E-SECRET-CONTEXT')
  ).not.toHaveLength(0)

  const pageB = await browser.newPage()
  await openApp(pageB, b)
  await goToSession(pageB, name)
  await expect(pageB.getByText('Remember E2E-SECRET-HISTORY')).toBeVisible()
  await expect(pageB.getByText('Here are the files')).toBeVisible()

  // The follow-up on B answers from the transferred history and files.
  const reply = await send(pageB, 'What do you remember?')
  expect(reply).toContain('E2E-SECRET-HISTORY')
  expect(reply).toContain('E2E-SECRET-PASTE')
  expect(reply).toContain('E2E-SECRET-CONTEXT')
  await shot(pageB, 'transfer-follow-up-on-b')
  await pageB.close()
})
