import { expect, test } from '@playwright/test'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSession, readEnv } from '../helpers'
import { goToSession, openApp, send, shot, uniqueName } from './ui'

const FIXTURE = join(import.meta.dirname, '../fixtures/architecture.png')

// Web Access: the image lives on the server, so the viewer offers Open in
// browser instead of Reveal, and Copy image copies the PNG itself (#68).
test('Copy image and Open in browser for a chat image (#68)', async ({
  page,
  context,
}) => {
  const { a, alphaA } = readEnv()
  copyFileSync(FIXTURE, join(alphaA.worktreePath, 'architecture.png'))
  const name = uniqueName('Images')
  await createSession(a, alphaA, name)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: a.url,
  })

  await openApp(page, a)
  await goToSession(page, name)
  await send(page, 'STUB:say ![Architecture diagram](architecture.png)')

  const image = page.getByRole('img', { name: 'Architecture diagram' })
  await expect(image).toBeVisible()

  // The context menu copies the image, not its URL.
  await image.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Copy image' })).toBeVisible()
  // Let the open animation finish before the screenshot.
  await page.waitForTimeout(500)
  await shot(page, 'image-context-menu')
  await page.getByRole('menuitem', { name: 'Copy image' }).click()
  await expect(page.getByText('Image copied')).toBeVisible()
  const types = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    return items.flatMap(item => item.types)
  })
  expect(types).toEqual(['image/png'])

  await image.click()
  const viewer = page.getByRole('dialog')
  await expect(viewer.getByRole('button', { name: 'Copy image' })).toBeVisible()
  await expect(viewer.getByRole('button', { name: /Reveal in/ })).toHaveCount(0)
  await page.waitForTimeout(500)
  await shot(page, 'image-viewer-web-access')

  const popup = page.waitForEvent('popup')
  await viewer.getByRole('button', { name: 'Open in browser' }).click()
  const tab = await popup
  await tab.waitForLoadState()
  expect(tab.url()).toContain('/api/project-files/')
  await tab.close()
})
