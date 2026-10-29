import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readEnv, RUN_DIR } from './helpers'
import type { Instance } from './launcher'

function stop(instance: Instance): void {
  try {
    process.kill(instance.pid, 'SIGTERM')
  } catch {
    // already gone
  }
}

/**
 * Content-based leak check. The real app and the real `claude` touch these
 * files all the time, so look for traces of this run, not for changes.
 */
function leaks(instances: Instance[]): string[] {
  const home = homedir()
  const found: string[] = []
  const configs = [
    '.claude.json',
    '.codex/config.toml',
    '.cursor/mcp.json',
    '.config/opencode/opencode.json',
  ]
  const appSupport = join(home, 'Library/Application Support')
  for (const dir of existsSync(appSupport) ? readdirSync(appSupport) : []) {
    if (dir.startsWith('app.splitkick.desktop')) {
      configs.push(join('Library/Application Support', dir, 'projects.json'))
    }
  }
  for (const file of configs) {
    const path = join(home, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const instance of instances) {
      if (text.includes(instance.root))
        found.push(`${path} mentions ${instance.root}`)
    }
  }
  for (const worktree of ['feature-a', 'feature-b']) {
    const path = join(home, 'splitkick/alpha', worktree)
    if (existsSync(path)) found.push(`${path} exists in the real home folder`)
  }
  return found
}

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_REUSE === '1') return
  if (!existsSync(join(RUN_DIR, 'env.json'))) return
  const { a, b } = readEnv()
  stop(a)
  stop(b)
  await new Promise(done => setTimeout(done, 1000))

  for (const instance of [a, b]) {
    cpSync(instance.log, join(RUN_DIR, `server-${instance.name}.log`))
  }

  // Keep both data dirs with the run: small, and the first thing to read
  // when a scenario fails.
  for (const instance of [a, b]) {
    cpSync(instance.data, join(RUN_DIR, `data-${instance.name}`), {
      recursive: true,
      filter: source =>
        !source.endsWith('.sock') && !source.includes('claude-cli'),
    })
  }
  if (process.env.E2E_KEEP !== '1') {
    for (const instance of [a, b])
      rmSync(instance.root, { recursive: true, force: true })
  }

  const found = leaks([a, b])
  if (found.length > 0) {
    throw new Error(`Sealing leak:\n${found.join('\n')}`)
  }
}
