/**
 * Flavor-aware web branding: the product name in index.html and the web icons
 * (browser tab, phone home screen), the latter emitted under a content-hashed
 * name. Used by the Vite plugin in vite.config.ts.
 *
 * The Tauri overlay (src-tauri/tauri.fork.conf.json) cannot reach any of this,
 * because these are frontend assets that Vite produces before Tauri runs.
 *
 * The hash is not cosmetic. index.html is the only file the HTTP server sends
 * with `no-store`; every other static asset gets
 * `public, max-age=31536000, immutable` (try_static_filesystem_response in
 * jean-core/src/http_server/server.rs). New bytes at a fixed /favicon.png would
 * therefore never reach a browser that already cached it. Hashing the name and
 * rewriting the href in index.html makes any artwork change - the JeanZ flavor
 * included - reach every existing instance on its next load. Do not put these
 * back on a fixed filename.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const WEB_ICONS = ['favicon.png', 'apple-touch-icon.png']

const FORK_FLAVOR = 'jeanz'
const FORK_ICON_DIR = 'src-tauri/icons-fork/web'
const UPSTREAM_ICON_DIR = 'public'

const UPSTREAM_PRODUCT_NAME = 'Jean'
const FORK_PRODUCT_NAME = 'JeanZ'

/**
 * The product name this build ships. Matches `productName` in the Tauri config
 * of the same flavor, which is what names the window and the macOS menu.
 */
export const PRODUCT_NAME =
  process.env.JEAN_FLAVOR === FORK_FLAVOR
    ? FORK_PRODUCT_NAME
    : UPSTREAM_PRODUCT_NAME

// Every place index.html names the product. Each one must still be present, so
// that a reworded index.html fails the build instead of silently shipping the
// upstream name under the fork icon.
const PRODUCT_NAME_ANCHORS = [
  `<title>${UPSTREAM_PRODUCT_NAME}</title>`,
  `content="${UPSTREAM_PRODUCT_NAME}"`,
]

/**
 * @typedef {object} WebIcon
 * @property {string} source Absolute path of the file this build should ship.
 * @property {string} from   URL index.html ships with today, e.g. `/favicon.png`.
 * @property {string} to     Hashed URL replacing it, e.g. `/favicon-1a2b3c4d.png`.
 */

/**
 * Picks the web icons for the flavor being built and hashes their contents.
 * JEAN_FLAVOR=jeanz takes the amber artwork, anything else the upstream
 * artwork from public/.
 *
 * @returns {WebIcon[]}
 */
export function resolveWebIcons() {
  const sourceDir =
    process.env.JEAN_FLAVOR === FORK_FLAVOR ? FORK_ICON_DIR : UPSTREAM_ICON_DIR

  return WEB_ICONS.map(file => {
    const source = path.resolve(sourceDir, file)
    const hash = createHash('sha256')
      .update(readFileSync(source))
      .digest('hex')
      .slice(0, 8)
    const ext = path.extname(file)
    return {
      source,
      from: `/${file}`,
      to: `/${path.basename(file, ext)}-${hash}${ext}`,
    }
  })
}

/**
 * Points the `<link>` tags in index.html at the hashed names, and names the
 * product for this flavor.
 *
 * @param {string} html
 * @param {WebIcon[]} icons
 * @param {string} [productName]
 * @returns {string}
 */
export function rewriteIndexHtml(html, icons, productName = PRODUCT_NAME) {
  const withIcons = icons.reduce((acc, icon) => {
    if (!acc.includes(`"${icon.from}"`)) {
      throw new Error(`index.html no longer links ${icon.from}`)
    }
    return acc.replaceAll(`"${icon.from}"`, `"${icon.to}"`)
  }, html)

  return PRODUCT_NAME_ANCHORS.reduce((acc, anchor) => {
    if (!acc.includes(anchor)) {
      throw new Error(`index.html no longer contains ${anchor}`)
    }
    return acc.replaceAll(
      anchor,
      anchor.replaceAll(UPSTREAM_PRODUCT_NAME, productName)
    )
  }, withIcons)
}

/**
 * Writes each icon under both its hashed name and its plain name. The hashed
 * name is what index.html requests; the plain name is overwritten so a JeanZ
 * bundle carries no upstream artwork for a request that goes straight to
 * /favicon.png.
 *
 * @param {string} outDir
 * @param {WebIcon[]} icons
 */
export function writeWebIcons(outDir, icons) {
  mkdirSync(outDir, { recursive: true })
  for (const icon of icons) {
    copyFileSync(icon.source, path.join(outDir, path.basename(icon.to)))
    copyFileSync(icon.source, path.join(outDir, path.basename(icon.from)))
  }
}
