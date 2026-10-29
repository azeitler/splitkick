import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { api, readEnv, waitForWorktree } from '../helpers'
import { openApp, shot, uniqueName } from './ui'

// API level: a merged PR comes from GitHub polling, which a sealed run has
// no access to. The decision logic is the real backend's.
test('merged PR archives a clean worktree (#50)', async ({ page }) => {
  const { a, alphaA } = readEnv()
  const name = uniqueName('to-archive').replace(' ', '-')
  const created = await api<{ id: string }>(a, 'create_worktree', {
    projectId: alphaA.projectId,
    customName: name,
  })
  const path = await waitForWorktree(a, alphaA.projectId, created.id)
  const prUrl = 'https://github.com/example/alpha/pull/1'
  await api(a, 'save_worktree_pr', {
    worktreeId: created.id,
    prNumber: 1,
    prUrl,
  })
  const headOid = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: path,
    encoding: 'utf8',
  }).trim()

  const outcome = await api(a, 'auto_archive_merged_worktree', {
    worktreeId: created.id,
    prUrl,
    headOid,
    delete: false,
  })
  expect(outcome).toBe('archived')

  const left = await api<{ id: string }[]>(a, 'list_worktrees', {
    projectId: alphaA.projectId,
  })
  expect(left.map(worktree => worktree.id)).not.toContain(created.id)
  const archived = await api<{ id: string }[]>(a, 'list_archived_worktrees')
  expect(archived.map(worktree => worktree.id)).toContain(created.id)

  await openApp(page, a)
  await expect(page.getByText(name)).toHaveCount(0)
  await shot(page, 'auto-archive')
})
