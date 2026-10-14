#!/usr/bin/env node
/**
 * Generates the Splitkick icon set in src-tauri/icons-fork/, plus the web
 * icons (favicon, apple-touch-icon) in src-tauri/icons-fork/web/.
 *
 * Sources (copied from the brand files, design/logo/final/ in the Splitkick
 * vault):
 *   source/icon.svg     mark A1c, used for every size from 64 px up
 *   source/favicon.svg  mark A4 (no swooshes), used for 16 and 32 px
 *
 * The marks use stroked paths. rsvg-convert renders strokes; ImageMagick's
 * own SVG renderer drops them, so SVGs go through rsvg-convert only and
 * ImageMagick only touches PNGs.
 *
 * Needs: rsvg-convert (brew install librsvg), magick, iconutil (macOS).
 * Usage: node scripts/generate-splitkick-icons.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forkDir = resolve(root, 'src-tauri/icons-fork')
const sourceDir = resolve(forkDir, 'source')
const webDir = resolve(forkDir, 'web')
const iconSvg = resolve(sourceDir, 'icon.svg')
const smallSvg = resolve(sourceDir, 'favicon.svg')
const appIcon = resolve(forkDir, 'app-icon.png')
const NAVY = '#141C2E'

function run(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }
}

function render(svg, size, out, extra = []) {
  run('rsvg-convert', [
    ...extra,
    '-w',
    String(size),
    '-h',
    String(size),
    svg,
    '-o',
    out,
  ])
}

// -strip drops timestamp chunks, so unchanged artwork keeps the same bytes and
// the content hash in the web icon names does not churn. PNG32 keeps RGBA:
// ImageMagick would otherwise save a palette PNG, which Tauri rejects.
function strip(file) {
  run('magick', [file, '-strip', `PNG32:${file}`])
}

mkdirSync(webDir, { recursive: true })

// 1. Full icon set from the 1024 px master.
render(iconSvg, 1024, appIcon)
strip(appIcon)
run('bunx', ['tauri', 'icon', appIcon, '-o', forkDir])
for (const mobileDir of ['android', 'ios']) {
  rmSync(resolve(forkDir, mobileDir), { recursive: true, force: true })
}

// 2. Small sizes use mark A4: the swooshes turn to noise below 64 px.
render(smallSvg, 32, resolve(forkDir, '32x32.png'))
strip(resolve(forkDir, '32x32.png'))

// 3. macOS .icns with A4 at 16/32 px and A1c from 64 px up.
const iconset = join(
  mkdtempSync(join(tmpdir(), 'splitkick-icns-')),
  'icon.iconset'
)
mkdirSync(iconset)
for (const [name, size, svg] of [
  ['icon_16x16.png', 16, smallSvg],
  ['icon_16x16@2x.png', 32, smallSvg],
  ['icon_32x32.png', 32, smallSvg],
  ['icon_32x32@2x.png', 64, iconSvg],
  ['icon_128x128.png', 128, iconSvg],
  ['icon_128x128@2x.png', 256, iconSvg],
  ['icon_256x256.png', 256, iconSvg],
  ['icon_256x256@2x.png', 512, iconSvg],
  ['icon_512x512.png', 512, iconSvg],
  ['icon_512x512@2x.png', 1024, iconSvg],
]) {
  render(svg, size, join(iconset, name))
}
run('iconutil', ['-c', 'icns', iconset, '-o', resolve(forkDir, 'icon.icns')])
rmSync(dirname(iconset), { recursive: true, force: true })

// 4. Web: favicon keeps the transparent margin; the phone home screen needs a
// full-bleed square (iOS rounds it and fills transparency with black).
render(smallSvg, 640, resolve(webDir, 'favicon.png'))
strip(resolve(webDir, 'favicon.png'))
const touch = resolve(webDir, 'apple-touch-icon.png')
render(smallSvg, 1024, touch, ['-b', NAVY])
run('magick', [
  touch,
  '-crop',
  '824x824+100+100',
  '+repage',
  '-resize',
  '180x180',
  '-strip',
  touch,
])

console.log('\nSplitkick icon set written to src-tauri/icons-fork/')
