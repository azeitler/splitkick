import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import {
  ARTIFACT_MESSAGE,
  ARTIFACT_READY_MESSAGE,
  PREVIEW_IFRAME_SANDBOX,
  buildSandboxedSrcdoc,
} from '../../src/components/artifact-preview/sandbox'

// Sandbox escape tests for HTML artifact previews (#76), in real Chromium.
// The frames are built with the app's sandbox token, srcdoc builder and the
// native bootstrap page; the attack page (`sandbox-escape.html`) tries to
// reach the network, the parent window, the Tauri globals and the app's
// storage. Threat model: docs/developer/artifact-preview.md.

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const attackPage = read('../fixtures/sandbox-escape.html')
// Also pasted into a chat of the native dev build to check WKWebView (#82).
const ipcProbePage = read('../fixtures/tauri-ipc-probe.html')
const bootstrapPage = read(
  '../../src-tauri/src/artifact_preview_bootstrap.html'
)
const nativeCsp = /pub const CSP: &str = "([^"]+)";/.exec(
  read('../../src-tauri/src/artifact_preview.rs')
)?.[1]

const HOST_URL = 'http://localhost:1421/__sandbox-host'
// The native app's loopback preview origin (artifact_preview.rs).
const ARTIFACT_URL = 'http://127.0.0.1:49152/frame'
// Like a release build: Tauri adds hashes to `script-src`, which turns
// `'unsafe-inline'` off (and a srcdoc frame inherits this policy).
const RELEASE_LIKE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; style-src 'self' 'unsafe-inline'; frame-src 'self' http://127.0.0.1:*"

const ATTACKS = [
  'read parent DOM',
  'read top DOM',
  'parent __TAURI_INTERNALS__',
  'parent __TAURI__',
  'own __TAURI_INTERNALS__',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'document.cookie',
  'window.open popup',
  'navigate top',
  'eval',
  'fetch',
  'WebSocket',
  'image from network',
  'external script',
]

async function openHost(page: Page, csp?: string) {
  const escapeRequests: string[] = []
  await page.route('**/__escape/**', route => {
    escapeRequests.push(route.request().url())
    return route.fulfill({ status: 200, body: 'leaked' })
  })
  const websockets: string[] = []
  page.on('websocket', ws => websockets.push(ws.url()))
  const popups: string[] = []
  page.on('popup', popup => popups.push(popup.url()))

  await page.route(HOST_URL, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: csp ? { 'Content-Security-Policy': csp } : {},
      body: '<!doctype html><title>host</title><body></body>',
    })
  )
  await page.route(ARTIFACT_URL, route =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      headers: { 'Content-Security-Policy': nativeCsp ?? '' },
      body: bootstrapPage,
    })
  )
  await page.goto(HOST_URL)
  // The host stands in for the app: a stored token, Tauri globals, and a
  // log of every message a frame sends.
  await page.evaluate(() => {
    localStorage.setItem('splitkick-token', 'secret')
    const w = window as unknown as Record<string, unknown>
    w.__TAURI_INTERNALS__ = { invoke: () => 'called' }
    w.__messages = []
    window.addEventListener('message', event => {
      ;(w.__messages as { origin: string }[]).push({ origin: event.origin })
    })
  })
  return { escapeRequests, websockets, popups }
}

/** What `SandboxedHtmlFrame` renders in Web Access. */
async function mountSrcdocFrame(page: Page, html = attackPage) {
  await page.evaluate(
    ({ srcdoc, sandbox }) => {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', sandbox)
      frame.srcdoc = srcdoc
      frame.style.cssText = 'width:800px;height:600px'
      document.body.appendChild(frame)
    },
    {
      srcdoc: buildSandboxedSrcdoc(html),
      sandbox: PREVIEW_IFRAME_SANDBOX,
    }
  )
}

/** What `SandboxedHtmlFrame` renders in the native app. */
async function mountNativeFrame(page: Page, html = attackPage) {
  await page.evaluate(
    ({ html, sandbox, url, ready, message }) => {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', sandbox)
      let sent = false
      window.addEventListener('message', event => {
        if (sent || event.source !== frame.contentWindow) return
        if (event.data?.type !== ready) return
        sent = true
        frame.contentWindow?.postMessage({ type: message, html }, '*')
      })
      frame.src = url
      frame.style.cssText = 'width:800px;height:600px'
      document.body.appendChild(frame)
    },
    {
      html: buildSandboxedSrcdoc(html),
      sandbox: PREVIEW_IFRAME_SANDBOX,
      url: ARTIFACT_URL,
      ready: ARTIFACT_READY_MESSAGE,
      message: ARTIFACT_MESSAGE,
    }
  )
}

async function expectNoEscape(
  page: Page,
  log: Awaited<ReturnType<typeof openHost>>
) {
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('#done')).toBeVisible({ timeout: 10_000 })
  await expect(frame.locator('#control')).toHaveText('Inline scripts run.')

  const results = await frame.locator('#results li').evaluateAll(items =>
    items.map(li => ({
      attack: (li as HTMLElement).dataset.attack,
      blocked: (li as HTMLElement).dataset.blocked,
      text: li.textContent,
    }))
  )
  for (const attack of ATTACKS) {
    expect(
      results.find(r => r.attack === attack),
      `missing result for ${attack}`
    ).toBeTruthy()
  }
  expect(results.filter(r => r.blocked !== 'true')).toEqual([])

  // Nothing reached the network, no window opened, the host stayed put.
  expect(log.escapeRequests).toEqual([])
  expect(log.websockets).toEqual([])
  expect(log.popups).toEqual([])
  expect(page.url()).toBe(HOST_URL)
  expect(
    await page.evaluate(() => localStorage.getItem('splitkick-token'))
  ).toBe('secret')

  // postMessage reaches the parent, but only with an opaque origin.
  const messages = await page.evaluate(
    () => (window as unknown as { __messages: { origin: string }[] }).__messages
  )
  expect(messages.length).toBeGreaterThan(0)
  expect(messages.every(m => m.origin === 'null')).toBe(true)
}

test('Web Access: a srcdoc preview cannot escape its sandbox', async ({
  page,
}) => {
  const log = await openHost(page)
  await mountSrcdocFrame(page)
  await expectNoEscape(page, log)
})

test('native app: the loopback origin preview cannot escape', async ({
  page,
}) => {
  expect(nativeCsp).toBeTruthy()
  const log = await openHost(page, RELEASE_LIKE_CSP)
  await mountNativeFrame(page)
  await expectNoEscape(page, log)
})

// The IPC probe (#82): no Tauri global, IPC handler or IPC URL in the frame.
// The native-only part (WKWebView shows the IPC handler to every frame) is
// guarded in Rust: artifact_preview.rs checks that Tauri rejects every
// command from the loopback origin. Manual check: docs/developer/artifact-preview.md.
const IPC_CHECKS = [
  'typeof __TAURI_INTERNALS__',
  'typeof __TAURI__',
  'typeof ipc',
  'typeof __TAURI_IPC__',
  'webkit.messageHandlers keys',
  'typeof webkit.messageHandlers.ipc',
  'document.URL',
  'origin',
  'document.domain',
  'parent.document',
  'top.__TAURI_INTERNALS__',
  'ipc.postMessage without key',
  'postMessage to parent',
  'fetch localhost',
  'fetch ipc.localhost',
]

async function expectNoIpc(page: Page) {
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('#done')).toHaveText('No IPC path reachable.', {
    timeout: 10_000,
  })
  await expect(frame.locator('#control')).toHaveText('Inline scripts run.')
  const checks = await frame
    .locator('#results tr')
    .evaluateAll(rows => rows.map(tr => (tr as HTMLElement).dataset.check))
  // The two fetch rows arrive in any order.
  expect([...checks].sort()).toEqual([...IPC_CHECKS].sort())
}

test('IPC probe: a srcdoc preview has no Tauri IPC', async ({ page }) => {
  await openHost(page)
  await mountSrcdocFrame(page, ipcProbePage)
  await expectNoIpc(page)
})

test('IPC probe: a loopback origin preview has no Tauri IPC', async ({
  page,
}) => {
  await openHost(page, RELEASE_LIKE_CSP)
  await mountNativeFrame(page, ipcProbePage)
  await expectNoIpc(page)
})

// Why the native app needs its own origin: under a release build's CSP, a
// srcdoc frame inherits the hashes and its inline scripts do not run.
test('srcdoc under a release-like app CSP runs no inline script', async ({
  page,
}) => {
  await openHost(page, RELEASE_LIKE_CSP)
  await mountSrcdocFrame(page)
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('h1')).toHaveText('Sandbox escape attempts')
  await expect(frame.locator('#control')).toHaveText(
    'Inline scripts do not run.'
  )
})
