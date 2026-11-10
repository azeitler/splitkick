/**
 * Guards the Web Access service worker (#72): the precache list, and the
 * requests the worker must never answer (API, socket, previews, build id).
 *
 * Usage: node --test scripts/web-service-worker.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { URL } from 'node:url'
import vm from 'node:vm'

import {
  CACHE_PREFIX,
  precacheUrlsFromIndexHtml,
  renderServiceWorker,
} from './web-service-worker.mjs'

const html = `<!doctype html><html><head>
<link rel="icon" href="/favicon-1a2b3c4d.png" />
<script type="module" crossorigin src="/assets/index-abc.js"></script>
<link rel="modulepreload" crossorigin href="/assets/terminal-def.js">
<link rel="modulepreload" crossorigin href="/assets/terminal-def.js">
<link rel="stylesheet" crossorigin href="/assets/index-123.css">
</head></html>`

describe('precacheUrlsFromIndexHtml', () => {
  it('lists each /assets file once, and nothing else', () => {
    assert.deepEqual(precacheUrlsFromIndexHtml(html), [
      '/assets/index-abc.js',
      '/assets/terminal-def.js',
      '/assets/index-123.css',
    ])
  })
})

/** Loads the worker in a sandbox and returns its fetch listener. */
function loadWorker() {
  const listeners = {}
  const self = {
    location: { origin: 'https://mac.tailnet.ts.net' },
    registration: { active: null },
    addEventListener: (type, listener) => {
      listeners[type] = listener
    },
    skipWaiting: () => Promise.resolve(),
  }
  const source = renderServiceWorker({
    buildId: '1.5.9-abc-2026',
    precacheUrls: ['/assets/index-abc.js'],
  })
  vm.runInNewContext(source, {
    self,
    URL,
    setTimeout,
    caches: { open: () => Promise.reject(new Error('no caches')) },
    fetch: () => Promise.reject(new Error('offline')),
  })
  return listeners
}

function respondsTo(listeners, url, init = {}) {
  let responded = false
  listeners.fetch({
    request: { url, method: 'GET', mode: 'cors', ...init },
    respondWith: promise => {
      responded = true
      // The sandbox has no real caches or network; only the routing counts.
      promise.catch(() => undefined)
    },
  })
  return responded
}

describe('renderServiceWorker', () => {
  it('names its cache by build id', () => {
    const source = renderServiceWorker({ buildId: 'b1', precacheUrls: [] })
    assert.match(source, new RegExp(`${CACHE_PREFIX}`))
    assert.match(source, /const BUILD_ID = "b1"/)
  })

  it('is valid JavaScript with install, activate, message and fetch', () => {
    const listeners = loadWorker()
    for (const type of ['install', 'activate', 'message', 'fetch']) {
      assert.equal(typeof listeners[type], 'function', type)
    }
  })

  it('answers navigations and hashed assets', () => {
    const listeners = loadWorker()
    const origin = 'https://mac.tailnet.ts.net'
    assert.ok(respondsTo(listeners, `${origin}/`, { mode: 'navigate' }))
    assert.ok(
      respondsTo(listeners, `${origin}/?token=secret`, { mode: 'navigate' })
    )
    assert.ok(respondsTo(listeners, `${origin}/assets/ChatWindow-x.js`))
  })

  it('never answers the API, the socket, previews or the build id', () => {
    const listeners = loadWorker()
    const origin = 'https://mac.tailnet.ts.net'
    for (const path of [
      '/api/init',
      '/ws?token=secret',
      '/preview/root/sig/index.html',
      '/jean-build.json',
      '/sw.js',
    ]) {
      assert.ok(
        !respondsTo(listeners, `${origin}${path}`, { mode: 'navigate' }),
        path
      )
      assert.ok(!respondsTo(listeners, `${origin}${path}`), path)
    }
  })

  it('never answers other origins or non-GET requests', () => {
    const listeners = loadWorker()
    assert.ok(!respondsTo(listeners, 'https://mb16.tailnet.ts.net/assets/a.js'))
    assert.ok(
      !respondsTo(listeners, 'https://mac.tailnet.ts.net/assets/a.js', {
        method: 'POST',
      })
    )
  })
})
