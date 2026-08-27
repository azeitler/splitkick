#!/usr/bin/env node
/**
 * Generates the JeanZ icon set in src-tauri/icons-fork/.
 *
 * Source of truth is src-tauri/icons-fork/app-icon.png. When that file is
 * missing (or --force is passed) it is derived from the upstream icon by
 * upscaling to 1024x1024 and rotating the hue, so the two apps are easy to
 * tell apart in the Dock. Drop in your own 1024x1024 app-icon.png and re-run
 * this script to replace the artwork.
 *
 * Usage: node scripts/generate-fork-icon.mjs [--force]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forkDir = resolve(root, 'src-tauri/icons-fork')
const appIcon = resolve(forkDir, 'app-icon.png')
const upstreamIcon = resolve(root, 'src-tauri/icons/icon.png')

// -modulate brightness,saturation,hue — hue is a percentage where 100 is no
// change and each 1% is 1.8 degrees. 175 rotates purple to amber.
const HUE = 175

function run(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }
}

mkdirSync(forkDir, { recursive: true })

const force = process.argv.includes('--force')
if (force || !existsSync(appIcon)) {
  if (!existsSync(upstreamIcon)) {
    throw new Error(`Missing source icon: ${upstreamIcon}`)
  }
  run('magick', [
    upstreamIcon,
    '-resize',
    '1024x1024',
    '-modulate',
    `100,110,${HUE}`,
    appIcon,
  ])
} else {
  console.log(`Using existing ${appIcon}`)
}

run('bunx', ['tauri', 'icon', appIcon, '-o', forkDir])

// The fork only ships desktop bundles; drop the mobile icon trees so the
// repository does not carry hundreds of unused files.
for (const mobileDir of ['android', 'ios']) {
  rmSync(resolve(forkDir, mobileDir), { recursive: true, force: true })
}

console.log('\nFork icon set written to src-tauri/icons-fork/')
