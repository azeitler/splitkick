#!/usr/bin/env bun
/**
 * Time backend commands over the Web Access WebSocket.
 *
 * Usage: bun scripts/perf/ws-bench.ts <port> <token> <scenario>
 *
 * Scenarios print one JSON line per command: name, ms, response bytes.
 * The data dir must come from scripts/perf/seed-remote-load.ts.
 */
const [port, token, scenario = 'commands'] = process.argv.slice(2)
if (!port || !token) {
  console.error('Usage: ws-bench.ts <port> <token> [scenario]')
  process.exit(1)
}

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`)
let nextId = 0
const pending = new Map<
  string,
  {
    resolve: (v: { data: unknown; bytes: number }) => void
    reject: (e: Error) => void
  }
>()
const events: { event: string; at: number; payload: unknown }[] = []
ws.onmessage = msg => {
  const text = String(msg.data)
  const parsed = JSON.parse(text)
  if (parsed.type === 'response' || parsed.type === 'error') {
    const p = pending.get(parsed.id)
    if (!p) return
    pending.delete(parsed.id)
    if (parsed.type === 'error') p.reject(new Error(parsed.error))
    else p.resolve({ data: parsed.data, bytes: text.length })
  } else if (parsed.type === 'event') {
    events.push({
      event: parsed.event,
      at: performance.now(),
      payload: parsed.payload,
    })
  }
}
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve()
  ws.onerror = () => reject(new Error('ws error'))
})

async function call(command: string, args: Record<string, unknown> = {}) {
  const id = `b${nextId++}`
  const started = performance.now()
  const result = await new Promise<{ data: unknown; bytes: number }>(
    (resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ type: 'invoke', id, command, args }))
    }
  )
  const ms = Math.round(performance.now() - started)
  return { ...result, ms }
}

async function timed(
  label: string,
  command: string,
  args: Record<string, unknown> = {}
) {
  try {
    const r = await call(command.split(' ')[0]!, args)
    console.log(JSON.stringify({ label, command, ms: r.ms, bytes: r.bytes }))
    return r.data
  } catch (e) {
    console.log(JSON.stringify({ label, command, error: String(e) }))
    return null
  }
}

type Project = { id: string; path: string }
type Worktree = { id: string; path: string; project_id: string }

const projects = (await timed('startup', 'list_projects')) as Project[]

if (scenario === 'commands') {
  const p0 = projects[0]!
  await timed('open-project', 'list_worktrees', { projectId: p0.id })
  const boot = (await timed('open-project', 'bootstrap_project', {
    projectId: p0.id,
  })) as {
    worktrees: Worktree[]
    sessionsByWorktree: Record<string, { sessions: { id: string }[] }>
  }
  await timed('open-project', 'bootstrap_project (warm)', { projectId: p0.id })
  const wt = boot.worktrees[0]!
  const sid = boot.sessionsByWorktree[wt.id]!.sessions[0]!.id
  await timed('open-session', 'get_session limit=25', {
    worktreeId: wt.id,
    worktreePath: wt.path,
    sessionId: sid,
    limit: 25,
  })
  await timed('open-session', 'get_session (no limit)', {
    worktreeId: wt.id,
    worktreePath: wt.path,
    sessionId: sid,
  })
  await timed('startup', 'list_all_sessions', {})
  // Sidebar: one bootstrap per project, as the sidebar sends them.
  const started = performance.now()
  const results = await Promise.all(
    projects.map(p =>
      call('bootstrap_project', { projectId: p.id }).catch(() => null)
    )
  )
  const bytes = results.reduce((n, r) => n + (r?.bytes ?? 0), 0)
  console.log(
    JSON.stringify({
      label: 'startup',
      command: `bootstrap_project x${projects.length} (parallel)`,
      ms: Math.round(performance.now() - started),
      bytes,
    })
  )
}

if (scenario === 'cached-status') {
  // One status write per worktree, as each client sends for a git:status-update.
  const wts = (await call('list_worktrees', { projectId: projects[0]!.id }))
    .data as Worktree[]
  const before = events.length
  for (const wt of wts) {
    await timed('status', 'update_worktree_cached_status (unchanged)', {
      worktreeId: wt.id,
      branch: null,
      prStatus: null,
      checkStatus: null,
      behindCount: 0,
      aheadCount: 0,
    })
  }
  await Bun.sleep(300)
  const invalidations = events
    .slice(before)
    .filter(e => e.event === 'cache:invalidate')
  console.log(
    JSON.stringify({
      label: 'status',
      command: 'cache:invalidate events received',
      count: invalidations.length,
      keys: invalidations.map(e =>
        (e.payload as { keys: string[] }).keys.join(',')
      ),
    })
  )
}

if (scenario === 'contention') {
  // list_projects latency while N slow commands (git fetch to a dead remote) run.
  const all: Worktree[] = []
  for (const p of projects.slice(0, 40)) {
    all.push(
      ...((await call('list_worktrees', { projectId: p.id }))
        .data as Worktree[])
    )
  }
  const slow = all.map(wt =>
    call('get_worktree_changes', { worktreeId: wt.id }).catch(e => ({
      ms: -1,
      bytes: 0,
      data: String(e),
    }))
  )
  for (let i = 0; i < 6; i++) {
    await Bun.sleep(2000)
    await timed(`during ${all.length} slow commands`, 'list_projects')
    await timed(`during ${all.length} slow commands`, 'load_preferences')
  }
  const done = await Promise.all(slow)
  console.log(
    JSON.stringify({
      label: 'contention',
      command: 'get_worktree_changes',
      count: done.length,
      maxMs: Math.max(...done.map(d => d.ms)),
    })
  )
}

ws.close()
process.exit(0)
