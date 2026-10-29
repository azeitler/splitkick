/** Helpers shared by global setup and the specs of the local e2e run (#65). */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import type { Instance } from './launcher'

export const RUN_DIR =
  process.env.E2E_LOCAL_RUN_DIR ??
  join(import.meta.dirname, '../../tmp/e2e-local', 'adhoc')
export const ENV_FILE = join(RUN_DIR, 'env.json')

export interface Fixture {
  projectId: string
  worktreeId: string
  worktreePath: string
}

export interface LocalEnv {
  a: Instance
  b: Instance
  alphaA: Fixture
  alphaB: Fixture
  bMarkerSessionId: string
}

export function readEnv(): LocalEnv {
  return JSON.parse(readFileSync(ENV_FILE, 'utf8')) as LocalEnv
}

export function writeEnv(env: LocalEnv): void {
  mkdirSync(RUN_DIR, { recursive: true })
  writeFileSync(ENV_FILE, JSON.stringify(env, null, 2))
}

/** Run a backend command through `POST /api/invoke`. */
export async function api<T = unknown>(
  instance: Instance,
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(`${instance.url}/api/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${instance.token}`,
    },
    body: JSON.stringify({ command, args }),
  })
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string }
  if (!body.ok) {
    throw new Error(`${instance.name} ${command}: ${body.error ?? res.status}`)
  }
  return body.data as T
}

/** Call a Splitkick MCP tool through the instance's socket. */
export function mcp<T = unknown>(
  instance: Instance,
  source: string,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  return new Promise((done, fail) => {
    const socket = net.connect(instance.socket)
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end < 0) return
      socket.end()
      const reply = JSON.parse(buffer.slice(0, end))
      if (reply.error) fail(new Error(JSON.stringify(reply.error)))
      else done(reply.result as T)
    })
    socket.on('error', fail)
    socket.write(
      JSON.stringify({
        token: instance.token,
        source,
        depth: 0,
        role: 'full',
        name,
        arguments: args,
      }) + '\n'
    )
  })
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: join(cwd, '..', '..', 'home') },
  }).trim()
}

/** A throwaway git repo with one commit inside the instance's root. */
export function createRepo(instance: Instance, name: string): string {
  const path = join(instance.repos, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'README.md'), `# ${name}\n\nE2E fixture repo.\n`)
  git(path, 'init', '-q')
  git(path, 'add', 'README.md')
  git(path, 'commit', '-q', '-m', 'Initial commit')
  return path
}

interface WorktreeInfo {
  id: string
  path: string
  name: string
  status?: string
}

/** Add the repo as a project and create one ready worktree in it. */
export async function seedProject(
  instance: Instance,
  repoPath: string,
  worktreeName: string
): Promise<Fixture> {
  const project = await api<{ id: string }>(instance, 'add_project', {
    path: repoPath,
  })
  const created = await api<WorktreeInfo>(instance, 'create_worktree', {
    projectId: project.id,
    customName: worktreeName,
  })
  return {
    projectId: project.id,
    worktreeId: created.id,
    worktreePath: await waitForWorktree(instance, project.id, created.id),
  }
}

export async function waitForWorktree(
  instance: Instance,
  projectId: string,
  worktreeId: string
): Promise<string> {
  for (let i = 0; i < 120; i++) {
    const list = await api<WorktreeInfo[]>(instance, 'list_worktrees', {
      projectId,
    })
    const found = list.find(item => item.id === worktreeId)
    if (found && found.status !== 'pending' && found.status !== 'creating') {
      return found.path
    }
    await new Promise(done => setTimeout(done, 250))
  }
  throw new Error(`${instance.name}: worktree ${worktreeId} not ready`)
}

export async function createSession(
  instance: Instance,
  fixture: Fixture,
  name: string
): Promise<string> {
  const session = await api<{ id: string }>(instance, 'create_session', {
    worktreeId: fixture.worktreeId,
    worktreePath: fixture.worktreePath,
    name,
  })
  return session.id
}

/**
 * Wait until no run of the session is still running. The UI shows the
 * answer a moment before the run is marked finished, and a transfer leaves
 * out a running turn.
 */
export async function waitForIdle(
  instance: Instance,
  sessionId: string
): Promise<void> {
  const path = join(instance.data, 'sessions/data', sessionId, 'metadata.json')
  for (let i = 0; i < 120; i++) {
    try {
      const { runs } = JSON.parse(readFileSync(path, 'utf8')) as {
        runs: { status: string }[]
      }
      if (runs.every(run => run.status !== 'running')) return
    } catch {
      // not written yet
    }
    await new Promise(done => setTimeout(done, 250))
  }
  throw new Error(`${instance.name}: session ${sessionId} still running`)
}
