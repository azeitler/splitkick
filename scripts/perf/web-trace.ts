#!/usr/bin/env bun
/**
 * Record the WebSocket commands Web Access sends per user action.
 *
 * Usage: bun scripts/perf/web-trace.ts <port> <token> [--throttle slow|3g|none] [--steps startup,project,session,switch]
 *
 * Needs a `vite build` in dist/ (served by the server) and a seeded data dir
 * (scripts/perf/seed-remote-load.ts). Prints per step: command counts, total
 * bytes and the time until the network goes quiet.
 */
import { chromium, type Page } from 'playwright'

const [port, token] = process.argv.slice(2)
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1]! : fallback
}
const throttle = arg('--throttle', 'none')
const steps = arg('--steps', 'startup,project,session,switch').split(',')

const PROFILES: Record<string, { latency: number; down: number; up: number }> =
  {
    // latency ms, bytes per second
    none: { latency: 0, down: -1, up: -1 },
    '3g': { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 },
    slow: { latency: 400, down: (400 * 1024) / 8, up: (400 * 1024) / 8 },
  }

type Frame = {
  at: number
  dir: 'out' | 'in'
  command?: string
  id?: string
  bytes: number
  type?: string
  event?: string
}
const frames: Frame[] = []
const sentAt = new Map<string, { command: string; at: number }>()

const browser = await chromium.launch({ headless: true })
const page: Page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
})
const cdp = await page.context().newCDPSession(page)
await cdp.send('Network.enable')
const profile = PROFILES[throttle]!
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: profile.latency,
  downloadThroughput: profile.down,
  uploadThroughput: profile.up,
})

page.on('websocket', ws => {
  ws.on('framesent', f => {
    const text = String(f.payload)
    try {
      const m = JSON.parse(text)
      if (m.type === 'invoke') {
        sentAt.set(m.id, { command: m.command, at: performance.now() })
        frames.push({
          at: performance.now(),
          dir: 'out',
          command: m.command,
          id: m.id,
          bytes: text.length,
        })
      }
    } catch {
      /* ignore */
    }
  })
  ws.on('framereceived', f => {
    const text = String(f.payload)
    try {
      const m = JSON.parse(text)
      const sent = m.id ? sentAt.get(m.id) : undefined
      frames.push({
        at: performance.now(),
        dir: 'in',
        bytes: text.length,
        type: m.type,
        command: sent?.command,
        id: m.id,
        event:
          m.event === 'cache:invalidate'
            ? `cache:invalidate ${JSON.stringify(m.payload)}`
            : m.event,
      })
    } catch {
      /* ignore */
    }
  })
})

let httpBytes = 0
page.on('response', async res => {
  if (res.url().includes('/api/init')) {
    const len = Number((await res.allHeaders())['content-length'] ?? 0)
    httpBytes += len
  }
})

async function quiet(ms = 1500, max = 90_000) {
  const start = performance.now()
  for (;;) {
    await page.waitForTimeout(250)
    const last = frames.at(-1)?.at ?? start
    const open = [...sentAt.keys()].filter(
      id => !frames.some(f => f.dir === 'in' && f.id === id)
    ).length
    if (open === 0 && performance.now() - last > ms) break
    if (performance.now() - start > max) break
  }
}

function report(step: string, from: number, t0: number) {
  const slice = frames.slice(from)
  const out = slice.filter(f => f.dir === 'out')
  const counts = new Map<string, { n: number; bytes: number; maxMs: number }>()
  for (const f of out) {
    const resp = slice.find(r => r.dir === 'in' && r.id === f.id)
    const c = counts.get(f.command!) ?? { n: 0, bytes: 0, maxMs: 0 }
    c.n++
    c.bytes += resp?.bytes ?? 0
    if (resp) c.maxMs = Math.max(c.maxMs, Math.round(resp.at - f.at))
    counts.set(f.command!, c)
  }
  const eventBytes = slice
    .filter(f => f.dir === 'in' && f.type === 'event')
    .reduce((n, f) => n + f.bytes, 0)
  const respBytes = slice
    .filter(f => f.dir === 'in' && f.type !== 'event')
    .reduce((n, f) => n + f.bytes, 0)
  const lastResp = slice
    .filter(f => f.dir === 'in' && f.type !== 'event')
    .at(-1)
  console.log(`\n== ${step} (throttle=${throttle}) ==`)
  console.log(
    JSON.stringify({
      commands: out.length,
      responseBytes: respBytes,
      eventBytes,
      lastResponseMs: lastResp ? Math.round(lastResp.at - t0) : 0,
    })
  )
  const rows = [...counts.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
  for (const [cmd, c] of rows)
    console.log(
      `  ${cmd.padEnd(36)} x${String(c.n).padEnd(4)} ${String(c.bytes).padStart(9)} B  max ${c.maxMs} ms`
    )
  if (process.argv.includes('--timeline')) {
    // Consecutive sends of one command and received events, collapsed.
    let prev = ''
    let n = 0
    let at = 0
    const flush = () =>
      prev && console.log(`  t+${String(at).padStart(5)}ms ${prev} x${n}`)
    for (const f of slice) {
      const key =
        f.dir === 'out'
          ? `-> ${f.command}`
          : f.type === 'event'
            ? `<- event ${f.event}`
            : ''
      if (!key) continue
      if (key === prev) {
        n++
        continue
      }
      flush()
      prev = key
      n = 1
      at = Math.round(f.at - t0)
    }
    flush()
  }
}

const base = `http://127.0.0.1:${port}`
// Native desktop flags off; this is plain Web Access.
let mark = frames.length
let t0 = performance.now()
await page.goto(`${base}/?token=${token}`)
await page.waitForSelector('text=Project 0', { timeout: 120_000 })
const sidebarMs = Math.round(performance.now() - t0)
await quiet()
if (steps.includes('startup')) {
  report('startup', mark, t0)
  console.log(
    JSON.stringify({
      sidebarVisibleMs: sidebarMs,
      initBytesCompressed: httpBytes,
    })
  )
}

if (steps.includes('project')) {
  mark = frames.length
  t0 = performance.now()
  await page.getByText('Project 7', { exact: true }).first().click()
  await quiet()
  report('open project 7', mark, t0)
}

if (steps.includes('session')) {
  mark = frames.length
  t0 = performance.now()
  await page.getByText('Project 0', { exact: true }).first().click()
  await quiet()
  report('back to project 0', mark, t0)
  mark = frames.length
  t0 = performance.now()
  const row = page.locator('text=/^Session [1-9]\\d*$/').first()
  await row.click()
  await quiet()
  report('open session', mark, t0)
}

if (steps.includes('switch')) {
  for (const name of ['Project 3', 'Project 0', 'Project 3']) {
    mark = frames.length
    t0 = performance.now()
    await page.getByText(name, { exact: true }).first().click()
    await quiet()
    report(`switch to ${name}`, mark, t0)
  }
}

if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
await browser.close()
