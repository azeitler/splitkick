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
const bootstrapPage = read(
  '../../src-tauri/src/artifact_preview_bootstrap.html'
)
const nativeCsp = /pub const CSP: &str = "([^"]+)";/.exec(
  read('../../src-tauri/src/artifact_preview.rs')
)?.[1]

const HOST_URL = 'http://localhost:1421/__sandbox-host'
// The Windows/Android form of the native scheme; Chromium has no custom ones.
const ARTIFACT_URL = 'http://splitkick-artifact.localhost/frame'
// Like a release build: Tauri adds hashes to `script-src`, which turns
// `'unsafe-inline'` off (and a srcdoc frame inherits this policy).
const RELEASE_LIKE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; style-src 'self' 'unsafe-inline'; frame-src 'self' http://splitkick-artifact.localhost"

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
async function mountSrcdocFrame(page: Page) {
  await page.evaluate(
    ({ srcdoc, sandbox }) => {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', sandbox)
      frame.srcdoc = srcdoc
      frame.style.cssText = 'width:800px;height:600px'
      document.body.appendChild(frame)
    },
    {
      srcdoc: buildSandboxedSrcdoc(attackPage),
      sandbox: PREVIEW_IFRAME_SANDBOX,
    }
  )
}

/** What `SandboxedHtmlFrame` renders in the native app. */
async function mountNativeFrame(page: Page) {
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
      html: buildSandboxedSrcdoc(attackPage),
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

test('native app: the splitkick-artifact origin preview cannot escape', async ({
  page,
}) => {
  expect(nativeCsp).toBeTruthy()
  const log = await openHost(page, RELEASE_LIKE_CSP)
  await mountNativeFrame(page)
  await expectNoEscape(page, log)
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
