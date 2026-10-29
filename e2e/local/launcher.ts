/**
 * Starts sealed Splitkick instances for the local two-instance e2e run (#65).
 *
 * Each instance is the desktop debug binary in `--headless` mode
 * (`jean_core::run_server`) with its own temp HOME, data dir, port and token.
 * Nothing it writes can land in the real home folder: every home path in
 * jean-core goes through `dirs`, which honours $HOME.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  writeFileSync,
} from 'node:fs'
import net from 'node:net'
import { join, resolve } from 'node:path'

export const REPO_ROOT = resolve(import.meta.dirname, '../..')
const BINARY = join(REPO_ROOT, 'src-tauri/target/debug/jean')
const STUB = join(import.meta.dirname, 'stub-claude.mjs')

export interface Instance {
  name: string
  /** Short root under /tmp: macOS limits socket paths to 104 bytes. */
  root: string
  home: string
  data: string
  repos: string
  port: number
  token: string
  url: string
  socket: string
  log: string
  pid: number
}

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = net.createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => done(port))
    })
  })
}

/** Create the sealed folders, preferences and stub CLI. Does not start. */
export function prepareInstance(name: string, port: number): Instance {
  const root = mkdtempSync(`/tmp/sk-e2e-${name}-`)
  const home = join(root, 'home')
  const data = join(root, 'data')
  const repos = join(root, 'repos')
  for (const dir of [home, data, repos, join(data, 'claude-cli')]) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\tname = E2E\n\temail = e2e@example.invalid\n[init]\n\tdefaultBranch = main\n'
  )

  const token = randomBytes(32).toString('base64url')
  // The MCP socket takes its token from this preference before the HTTP
  // token is chosen, so seed it instead of passing --token: both then match.
  writeFileSync(
    join(data, 'preferences.json'),
    JSON.stringify(
      {
        theme: 'system',
        http_server_token: token,
        jean_mcp_enabled: true,
        default_backend: 'claude',
        claude_cli_source: 'jean',
        // Never replace the stub CLI with a downloaded one.
        auto_update_ai_backends: false,
        // First-run dialogs that would cover the UI in a fresh data dir.
        has_seen_feature_tour: true,
        has_seen_jean_config_wizard: true,
        has_seen_jean_mcp_intro: true,
        has_seen_external_display_zoom_tip: true,
      },
      null,
      2
    )
  )

  // A managed CLI at <data>/claude-cli/claude wins over PATH. Exec node by
  // absolute path: the server swaps PATH for the login shell's, and the
  // temp HOME has no shell profile that would add asdf.
  const cli = join(data, 'claude-cli/claude')
  writeFileSync(cli, `#!/bin/sh\nexec "${process.execPath}" "${STUB}" "$@"\n`)
  chmodSync(cli, 0o755)

  return {
    name,
    root,
    home,
    data,
    repos,
    port,
    token,
    url: `http://127.0.0.1:${port}`,
    socket: join(data, 'jean-mcp.sock'),
    log: join(root, 'server.log'),
    pid: 0,
  }
}

/** Start the instance and wait until it serves requests. */
export async function startInstance(
  instance: Instance,
  allowedOrigins: string[]
): Promise<ChildProcess> {
  mkdirSync(join(instance.root, 'tmp'), { recursive: true })
  const log = openSync(instance.log, 'a')
  const child = spawn(BINARY, ['--headless'], {
    cwd: instance.home,
    env: {
      PATH: process.env.PATH,
      SHELL: '/bin/zsh',
      USER: process.env.USER,
      LOGNAME: process.env.LOGNAME,
      TMPDIR: join(instance.root, 'tmp'),
      HOME: instance.home,
      SPLITKICK_DATA_DIR: instance.data,
      SPLITKICK_IMPORT_SOURCE: join(instance.root, 'no-import'),
      JEAN_HOST: '127.0.0.1',
      JEAN_PORT: String(instance.port),
      JEAN_ALLOWED_ORIGINS: allowedOrigins.join(','),
      // Debug builds overflow the default stack on MCP calls.
      RUST_MIN_STACK: '33554432',
      RUST_LOG: 'info',
    },
    stdio: ['ignore', log, log],
  })
  // Teardown stops it by pid; do not keep the runner alive.
  child.unref()
  instance.pid = child.pid ?? 0

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `${instance.name} exited with ${child.exitCode}; see ${instance.log}`
      )
    }
    try {
      const res = await fetch(`${instance.url}/readyz`)
      if (res.ok) return child
    } catch {
      // not listening yet
    }
    await new Promise(done => setTimeout(done, 250))
  }
  child.kill('SIGKILL')
  throw new Error(`${instance.name} did not start in 60 s; see ${instance.log}`)
}
