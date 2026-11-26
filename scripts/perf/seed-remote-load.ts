#!/usr/bin/env bun
/**
 * Seed a synthetic Splitkick data dir for remote-load measurements.
 *
 * Usage: bun scripts/perf/seed-remote-load.ts /tmp/sk-perf [--remote-url git://127.0.0.1:9419/x]
 *
 * Writes only generated data (no real user data): ~80 projects, ~240
 * worktrees (real git repos, so git status works), ~400 sessions, a few with
 * 300+ runs. Run logs are hard links to the neutral test fixture in
 * jean-core/src/chat/testdata, so the dir stays small on disk.
 *
 * `--remote-url` sets `origin` of every repo, e.g. to a TCP port that never
 * answers, to reproduce `git fetch` timeouts.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
if (!root || !root.startsWith('/tmp/')) {
  console.error('Usage: seed-remote-load.ts /tmp/<dir> [--remote-url <url>]')
  process.exit(1)
}
const remoteIdx = process.argv.indexOf('--remote-url')
const remoteUrl = remoteIdx > 0 ? process.argv[remoteIdx + 1] : undefined

const PROJECTS = 80
const SESSIONS = 400
const LONG_SESSIONS = 8 // 300+ runs each

const repoRoot = path.resolve(import.meta.dir, '../..')
const bigLog = path.join(
  repoRoot,
  'jean-core/src/chat/testdata/issue_73_run_log.jsonl'
)
const smallLog = path.join(
  repoRoot,
  'jean-core/src/chat/testdata/dialog_end_turn_run_log.jsonl'
)

const dataDir = path.join(root, 'data')
const reposDir = path.join(root, 'repos')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(path.join(dataDir, 'sessions/index'), { recursive: true })
fs.mkdirSync(path.join(dataDir, 'sessions/data'), { recursive: true })
fs.mkdirSync(path.join(dataDir, 'fixtures'), { recursive: true })
fs.mkdirSync(reposDir, { recursive: true })

// Fixture copies inside the data dir so hard links stay on one volume.
const bigFixture = path.join(dataDir, 'fixtures/big.jsonl')
const smallFixture = path.join(dataDir, 'fixtures/small.jsonl')
fs.copyFileSync(bigLog, bigFixture)
fs.copyFileSync(smallLog, smallFixture)

let seed = 42
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const uuid = (prefix: string, n: number) =>
  `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'ignore' })

const now = Math.floor(Date.now() / 1000)
const projects: Record<string, unknown>[] = []
const worktrees: Record<string, unknown>[] = []

for (let p = 0; p < PROJECTS; p++) {
  const id = uuid('proj', p)
  const repo = path.join(reposDir, `project-${p}`)
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(
    repo,
    '-c',
    'user.name=Seed',
    '-c',
    'user.email=seed@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  )
  if (remoteUrl) git(repo, 'remote', 'add', 'origin', remoteUrl)
  projects.push({
    id,
    name: `Project ${p}`,
    path: repo,
    default_branch: 'main',
    added_at: now - p * 3600,
    order: p,
    hidden: false,
  })
  worktrees.push({
    id: uuid('base', p),
    project_id: id,
    name: 'main',
    path: repo,
    branch: 'main',
    created_at: now - p * 3600,
    session_type: 'base',
    order: 0,
  })
  const extra = 2 + Math.floor(rand() * 3) // 2..4 worktrees
  for (let w = 0; w < extra; w++) {
    const branch = `feature-${w}`
    const wtPath = path.join(reposDir, `project-${p}-wt-${w}`)
    git(repo, 'worktree', 'add', '-q', '-b', branch, wtPath)
    worktrees.push({
      id: uuid('wt' + String(p).padStart(2, '0'), w),
      project_id: id,
      name: branch,
      path: wtPath,
      branch,
      created_at: now - p * 3600 + w,
      order: w + 1,
    })
  }
}

fs.writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({ projects, worktrees }, null, 2)
)

// Sessions: spread over worktrees; the first LONG_SESSIONS go to project 0/1
// so the focused project holds the expensive ones.
const sessionsByWorktree = new Map<string, string[]>()
let totalRuns = 0
for (let s = 0; s < SESSIONS; s++) {
  const wt =
    s < LONG_SESSIONS
      ? worktrees[s % 4]!
      : worktrees[Math.floor(rand() * worktrees.length)]!
  const wtId = wt.id as string
  const sid = uuid('sess', s)
  const runs =
    s < LONG_SESSIONS
      ? 300 + Math.floor(rand() * 100)
      : Math.floor(rand() * 30) + 1
  const sessionDir = path.join(dataDir, 'sessions/data', sid)
  fs.mkdirSync(sessionDir, { recursive: true })
  const runEntries = []
  for (let r = 0; r < runs; r++) {
    const runId = uuid('run' + String(s).padStart(3, '0'), r)
    // Long sessions: every 4th run is a big agentic run (~100 KB log).
    const fixture = r % 4 === 0 ? bigFixture : smallFixture
    fs.linkSync(fixture, path.join(sessionDir, `${runId}.jsonl`))
    runEntries.push({
      run_id: runId,
      user_message_id: uuid('umsg', s * 1000 + r),
      user_message: `Synthetic prompt ${r} for session ${s}. `.repeat(4),
      model: 'claude-sonnet-4-6',
      execution_mode: 'build',
      backend: 'claude',
      started_at: now - (runs - r) * 120,
      ended_at: now - (runs - r) * 120 + 60,
      status: 'completed',
      assistant_message_id: uuid('amsg', s * 1000 + r),
      cancelled: false,
      recovered: false,
    })
  }
  totalRuns += runs
  fs.writeFileSync(
    path.join(sessionDir, 'metadata.json'),
    JSON.stringify({
      id: sid,
      worktree_id: wtId,
      name: `Session ${s}`,
      order: sessionsByWorktree.get(wtId)?.length ?? 0,
      created_at: now - runs * 120,
      backend: 'claude',
      runs: runEntries,
    })
  )
  sessionsByWorktree.set(wtId, [...(sessionsByWorktree.get(wtId) ?? []), sid])
}

for (const wt of worktrees) {
  const ids = sessionsByWorktree.get(wt.id as string) ?? []
  fs.writeFileSync(
    path.join(dataDir, 'sessions/index', `${wt.id}.json`),
    JSON.stringify({
      worktree_id: wt.id,
      active_session_id: ids[0] ?? null,
      sessions: ids.map((id, order) => ({
        id,
        name: `Session ${id.slice(-4)}`,
        order,
        message_count: 0,
      })),
      version: 2,
      branch_naming_completed: true,
    })
  )
}

// Focus project 0 with its first long session open.
const activeSessionIds: Record<string, string> = {}
for (const wt of worktrees.slice(0, 4)) {
  const first = sessionsByWorktree.get(wt.id as string)?.[0]
  if (first) activeSessionIds[wt.id as string] = first
}
fs.writeFileSync(
  path.join(dataDir, 'ui-state.json'),
  JSON.stringify({
    active_project_id: projects[0]!.id,
    active_worktree_id: worktrees[0]!.id,
    active_worktree_path: worktrees[0]!.path,
    active_session_ids: activeSessionIds,
    expanded_project_ids: [projects[0]!.id],
    left_sidebar_visible: true,
  })
)
// No preferences.json: the server uses its defaults. A partial file fails
// to parse (`missing field theme`) and changes what the client loads.

console.log(
  JSON.stringify({
    dataDir,
    projects: projects.length,
    worktrees: worktrees.length,
    sessions: SESSIONS,
    runs: totalRuns,
  })
)
