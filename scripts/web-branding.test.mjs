/**
 * Guards the Splitkick web branding: the product name in index.html and the
 * web icons (browser tab, phone home screen), which are emitted under a
 * content-hashed name.
 *
 * The hash is not cosmetic: the HTTP server sends every static asset except
 * index.html with `public, max-age=31536000, immutable`, so new bytes at a
 * fixed /favicon.png would never reach a browser that already cached it.
 *
 * Usage: node --test scripts/web-branding.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PRODUCT_NAME,
  WEB_ICONS,
  resolveWebIcons,
  rewriteIndexHtml,
  writeWebIcons,
} from './web-branding.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ICON_DIR = 'src-tauri/icons-fork/web'
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// resolveWebIcons resolves against the working directory, the way Vite runs it.
process.chdir(root)

function readIcon(dir, file) {
  return readFileSync(join(root, dir, file))
}

/** Reads width and height out of a PNG IHDR chunk. */
function pngSize(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC, 'not a PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const tempDirs = []

function tempOutDir() {
  const dir = mkdtempSync(join(tmpdir(), 'splitkick-web-icons-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('Splitkick web icon artwork', () => {
  for (const file of WEB_ICONS) {
    it(`${file} matches the upstream icon dimensions`, () => {
      assert.deepEqual(
        pngSize(readIcon(ICON_DIR, file)),
        pngSize(readIcon('public', file))
      )
    })

    it(`${file} is not the upstream artwork`, () => {
      assert.notDeepEqual(readIcon(ICON_DIR, file), readIcon('public', file))
    })
  }
})

describe('web icon emission', () => {
  const html =
    '<link rel="icon" type="image/png" href="/favicon.png" />' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />' +
    '<meta name="apple-mobile-web-app-title" content="Jean" />' +
    '<title>Jean</title>'

  it('rewrites every href to a hashed name it also writes', () => {
    const outDir = tempOutDir()
    const icons = resolveWebIcons()
    const rewritten = rewriteIndexHtml(html, icons)
    writeWebIcons(outDir, icons)

    assert.equal(icons.length, WEB_ICONS.length)
    for (const icon of icons) {
      assert.match(icon.to, /-[0-9a-f]{8}\.png$/)
      assert.ok(rewritten.includes(`"${icon.to}"`), `href missing: ${icon.to}`)
      assert.ok(
        !rewritten.includes(`"${icon.from}"`),
        `href kept: ${icon.from}`
      )
      assert.deepEqual(
        readFileSync(join(outDir, icon.to.slice(1))),
        readFileSync(icon.source)
      )
    }
  })

  it('ships the Splitkick artwork under the plain names too', () => {
    const outDir = tempOutDir()
    writeWebIcons(outDir, resolveWebIcons())

    for (const file of WEB_ICONS) {
      // A direct /favicon.png request never returns the upstream glyph.
      assert.deepEqual(
        readFileSync(join(outDir, file)),
        readIcon(ICON_DIR, file)
      )
    }
  })
})

describe('product name', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8')

  it('is Splitkick', () => {
    assert.equal(PRODUCT_NAME, 'Splitkick')
  })

  it('renames the real index.html', () => {
    const renamed = rewriteIndexHtml(html, resolveWebIcons())

    assert.match(renamed, /<title>Splitkick<\/title>/)
    assert.match(
      renamed,
      /name="apple-mobile-web-app-title" content="Splitkick"/
    )
    assert.ok(!renamed.includes('<title>Jean</title>'), 'title left behind')
    assert.ok(!renamed.includes('content="Jean"'), 'meta title left behind')
  })

  it('fails loudly when index.html stops naming the product', () => {
    const reworded = html.replace('<title>Jean</title>', '<title>Hello</title>')

    assert.throws(
      () => rewriteIndexHtml(reworded, resolveWebIcons()),
      /no longer contains <title>Jean<\/title>/
    )
  })

  it('fails loudly when index.html stops linking an icon', () => {
    const unlinked = html.replace('href="/favicon.png"', 'href="/other.png"')

    assert.throws(
      () => rewriteIndexHtml(unlinked, resolveWebIcons()),
      /no longer links \/favicon\.png/
    )
  })
})
