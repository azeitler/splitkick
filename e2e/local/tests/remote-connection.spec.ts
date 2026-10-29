import { expect, test } from '@playwright/test'
import { readEnv } from '../helpers'
import { goToSession, openApp, runCommand, shot } from './ui'

test('A switches to B as a remote connection and back', async ({ page }) => {
  const { a, b } = readEnv()
  await openApp(page, a, [
    { id: 'b', name: 'Instance B', url: b.url, token: b.token },
  ])

  await runCommand(page, 'Instance B')
  // The title bar names the remote the window shows.
  const remoteChip = page.getByLabel('Remote instance Instance B')
  await expect(remoteChip).toBeVisible()

  // B's own session and worktree prove the window now talks to B.
  await goToSession(page, 'B-only marker')
  await expect(page.getByText('alpha › feature-b').first()).toBeVisible()
  await shot(page, 'remote-connection-on-b')

  await runCommand(page, 'Localhost')
  await expect(remoteChip).toHaveCount(0)
  await goToSession(page, 'Session 1')
  await expect(page.getByText('alpha › feature-a').first()).toBeVisible()
  await shot(page, 'remote-connection-back-on-a')
})
