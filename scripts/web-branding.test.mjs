/**
 * Guards the flavor-aware web branding: the product name in index.html and the
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
const FORK_ICON_DIR = 'src-tauri/icons-fork/web'
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

function withFlavor(flavor, run) {
  const previous = process.env.JEAN_FLAVOR
  if (flavor === undefined) delete process.env.JEAN_FLAVOR
  else process.env.JEAN_FLAVOR = flavor
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.JEAN_FLAVOR
    else process.env.JEAN_FLAVOR = previous
  }
}

const tempDirs = []

function tempOutDir() {
  const dir = mkdtempSync(join(tmpdir(), 'jean-web-icons-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('JeanZ web icon artwork', () => {
  for (const file of WEB_ICONS) {
    it(`${file} matches the upstream icon dimensions`, () => {
      assert.deepEqual(
        pngSize(readIcon(FORK_ICON_DIR, file)),
        pngSize(readIcon('public', file))
      )
    })

    it(`${file} is actually re-coloured, not a copy`, () => {
      // A plain copy would ship the purple artwork under the JeanZ name.
      assert.notDeepEqual(
        readIcon(FORK_ICON_DIR, file),
        readIcon('public', file)
      )
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
    const icons = withFlavor(undefined, resolveWebIcons)
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

  it('ships the upstream artwork without the flavor flag', () => {
    const outDir = tempOutDir()
    writeWebIcons(outDir, withFlavor(undefined, resolveWebIcons))

    for (const file of WEB_ICONS) {
      assert.deepEqual(
        readFileSync(join(outDir, file)),
        readIcon('public', file)
      )
    }
  })

  it('ships the JeanZ artwork under JEAN_FLAVOR=jeanz', () => {
    const outDir = tempOutDir()
    const icons = withFlavor('jeanz', resolveWebIcons)
    writeWebIcons(outDir, icons)

    for (const icon of icons) {
      assert.ok(icon.source.includes('icons-fork/web'), icon.source)
    }
    for (const file of WEB_ICONS) {
      // Both the hashed name and the plain name carry the flavor artwork, so a
      // direct /favicon.png request never returns the upstream glyph.
      assert.deepEqual(
        readFileSync(join(outDir, file)),
        readIcon(FORK_ICON_DIR, file)
      )
    }
  })

  it('gives the two flavors different hashed names', () => {
    // This is what lets a JeanZ update reach a browser that cached the
    // upstream icon for a year.
    const upstream = withFlavor(undefined, resolveWebIcons)
    const fork = withFlavor('jeanz', resolveWebIcons)

    upstream.forEach((icon, index) => {
      assert.equal(fork[index].from, icon.from)
      assert.notEqual(fork[index].to, icon.to)
    })
  })
})

describe('product name', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  const icons = () => withFlavor(undefined, resolveWebIcons)

  // PRODUCT_NAME resolves when the module loads, so each flavor needs its own
  // module instance. A unique query string defeats the ESM cache. The env has
  // to stay set until the import resolves, so this cannot use withFlavor.
  const loadProductName = async (flavor, tag) => {
    const previous = process.env.JEAN_FLAVOR
    if (flavor === undefined) delete process.env.JEAN_FLAVOR
    else process.env.JEAN_FLAVOR = flavor
    try {
      const module = await import(`./web-branding.mjs?flavor=${tag}`)
      return module.PRODUCT_NAME
    } finally {
      if (previous === undefined) delete process.env.JEAN_FLAVOR
      else process.env.JEAN_FLAVOR = previous
    }
  }

  it('is Jean by default', () => {
    assert.equal(PRODUCT_NAME, 'Jean')
  })

  it('follows the flavor flag', async () => {
    assert.equal(await loadProductName(undefined, 'upstream'), 'Jean')
    assert.equal(await loadProductName('jeanz', 'fork'), 'JeanZ')
  })

  it('renames the real index.html for the fork', () => {
    const renamed = rewriteIndexHtml(html, icons(), 'JeanZ')

    assert.match(renamed, /<title>JeanZ<\/title>/)
    assert.match(renamed, /name="apple-mobile-web-app-title" content="JeanZ"/)
    assert.ok(!renamed.includes('<title>Jean</title>'), 'title left behind')
    assert.ok(!renamed.includes('content="Jean"'), 'meta title left behind')
  })

  it('leaves the real index.html alone for the upstream flavor', () => {
    const rewritten = rewriteIndexHtml(html, icons(), 'Jean')

    assert.ok(rewritten.includes('<title>Jean</title>'))
    assert.ok(rewritten.includes('content="Jean"'))
  })

  it('fails loudly when index.html stops naming the product', () => {
    const reworded = html.replace('<title>Jean</title>', '<title>Hello</title>')

    assert.throws(
      () => rewriteIndexHtml(reworded, icons(), 'JeanZ'),
      /no longer contains <title>Jean<\/title>/
    )
  })

  it('fails loudly when index.html stops linking an icon', () => {
    const unlinked = html.replace('href="/favicon.png"', 'href="/other.png"')

    assert.throws(
      () => rewriteIndexHtml(unlinked, icons(), 'JeanZ'),
      /no longer links \/favicon\.png/
    )
  })
})
