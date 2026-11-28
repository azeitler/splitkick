import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  START_LOADER_SOURCE,
  rewriteIndexHtmlForStartLoader,
} from './web-start-loader.mjs'
import { precacheUrlsFromIndexHtml } from './web-service-worker.mjs'

const built = `<!doctype html><html><head>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/markdown-def.js">
    <link rel="modulepreload" crossorigin href="/assets/tauri-ghi.js">
    <link rel="stylesheet" crossorigin href="/assets/index-123.css">
</head><body>
<div id="app-skeleton"></div>
<div id="root"></div>
</body></html>`

const sizes = {
  '/assets/index-abc.js': 400,
  '/assets/markdown-def.js': 100,
  '/assets/tauri-ghi.js': 10,
}
const rewritten = rewriteIndexHtmlForStartLoader(built, url => sizes[url] ?? 0)

describe('rewriteIndexHtmlForStartLoader', () => {
  it('turns the entry and its preloads into app-asset links with sizes', () => {
    assert.doesNotMatch(rewritten, /<script type="module"/)
    assert.doesNotMatch(rewritten, /rel="modulepreload"/)
    assert.match(
      rewritten,
      /<link rel="app-asset" data-entry href="\/assets\/index-abc\.js" data-size="400">/
    )
    assert.match(
      rewritten,
      /<link rel="app-asset" href="\/assets\/markdown-def\.js" data-size="100">/
    )
    assert.match(
      rewritten,
      /<link rel="app-asset" href="\/assets\/tauri-ghi\.js" data-size="10">/
    )
  })

  it('keeps the stylesheet tag and adds the loader before </body>', () => {
    assert.match(
      rewritten,
      /<link rel="stylesheet" crossorigin href="\/assets\/index-123\.css">/
    )
    const loaderAt = rewritten.indexOf(START_LOADER_SOURCE)
    assert.ok(loaderAt > rewritten.indexOf('<div id="app-skeleton">'))
    assert.ok(loaderAt < rewritten.indexOf('</body>'))
  })

  // The service worker precaches what index.html names under href/src.
  it('leaves the service worker precache list unchanged', () => {
    assert.deepEqual(
      precacheUrlsFromIndexHtml(rewritten),
      precacheUrlsFromIndexHtml(built)
    )
  })

  it('leaves a page without a module entry alone (vite dev)', () => {
    const dev =
      '<html><body><script type="module" src="/src/main.tsx"></script></body></html>'
    assert.equal(
      rewriteIndexHtmlForStartLoader(dev, () => 0),
      dev
    )
  })
})
