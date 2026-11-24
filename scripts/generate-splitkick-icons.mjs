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
 * `--dev` builds only the dev build's icons (src-tauri/icons-fork/dev/): the
 * committed app-icon.png with a yellow DEV pill, so a dev build is easy to
 * tell from the installed app in the Dock. tauri.conf.dev.json points there.
 *
 * Needs: rsvg-convert (brew install librsvg), magick, iconutil (macOS).
 * Usage: node scripts/generate-splitkick-icons.mjs [--dev]
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

/**
 * The dev icons: app-icon.png plus a DEV pill on the lower part of the
 * squircle (824 px in the 1024 px canvas, from 100 to 924). Tauri takes the
 * Dock icon of a macOS dev build from the first .icns in `bundle.icon` and
 * the window icon from the first .png.
 */
function devIcons() {
  const devDir = resolve(forkDir, 'dev')
  mkdirSync(devDir, { recursive: true })
  const master = resolve(devDir, 'icon.png')
  run('magick', [
    appIcon,
    '-fill',
    '#FACC15',
    '-draw',
    'roundrectangle 282,736 742,880 72,72',
    '-fill',
    NAVY,
    '-font',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '-pointsize',
    '108',
    '-gravity',
    'north',
    '-annotate',
    '+0+752',
    'DEV',
    master,
  ])
  strip(master)
  const iconset = join(
    mkdtempSync(join(tmpdir(), 'splitkick-dev-icns-')),
    'icon.iconset'
  )
  mkdirSync(iconset)
  for (const [name, size] of [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]) {
    run('magick', [master, '-resize', `${size}x${size}`, join(iconset, name)])
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', resolve(devDir, 'icon.icns')])
  rmSync(dirname(iconset), { recursive: true, force: true })
  console.log('\nSplitkick dev icons written to src-tauri/icons-fork/dev/')
}

if (process.argv.includes('--dev')) {
  devIcons()
  process.exit(0)
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
devIcons()
