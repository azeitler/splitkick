import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createSession, readEnv, waitForIdle } from '../helpers'
import type { Instance } from '../launcher'
import { chatInput, goToSession, openApp, shot, uniqueName } from './ui'

function runStatuses(instance: Instance, sessionId: string): string[] {
  const path = join(instance.data, 'sessions/data', sessionId, 'metadata.json')
  try {
    const { runs } = JSON.parse(readFileSync(path, 'utf8')) as {
      runs: { status: string }[]
    }
    return runs.map(run => run.status)
  } catch {
    return []
  }
}

// The desktop watchdog reloads an empty window (#97). A reload throws away
// the page only: the run lives in the backend, keeps going, and its answer
// shows in the reloaded page.
test('a running session keeps running through a page reload (#97)', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const name = uniqueName('Reload')
  const sessionId = await createSession(a, alphaA, name)

  await openApp(page, a)
  await goToSession(page, name)
  await chatInput(page).fill(
    ['STUB:sleep 8000', 'STUB:say survived the reload'].join('\n')
  )
  await page.keyboard.press('Enter')
  await expect
    .poll(() => runStatuses(a, sessionId), { timeout: 20_000 })
    .toContain('running')

  await page.reload()
  await goToSession(page, name)
  // Still running after the reload: no answer yet.
  expect(runStatuses(a, sessionId)).toContain('running')
  const answer = page.locator('p', { hasText: /^survived the reload$/ })
  await expect(answer).toHaveCount(0)

  await expect(answer.first()).toBeVisible({ timeout: 60_000 })
  await shot(page, 'reload-run-survived')
  await waitForIdle(a, sessionId)
  expect(runStatuses(a, sessionId)).toEqual(['completed'])
})
