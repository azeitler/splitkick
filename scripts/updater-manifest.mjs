#!/usr/bin/env node
/**
 * Writes `latest.json`, the feed the in-app updater polls, from the update
 * packages that the release builds produced.
 *
 * Every platform whose package and `.sig` are in the folder gets an entry;
 * a platform without them is left out. The updater validates every entry
 * before it compares versions, so a half-written entry would break the
 * update for all platforms: https://v2.tauri.app/plugin/updater/
 *
 * Run as `node scripts/updater-manifest.mjs <folder>` with VERSION, TAG and
 * REPOSITORY set. Writes `<folder>/latest.json` and prints the platform keys.
 * With no package at all it writes nothing and still exits 0: that build
 * simply ships no in-app update.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Release asset per updater platform key. The key is the updater's
 * `OS-ARCH`; an NSIS build also asks for `windows-x86_64-nsis` first and
 * falls back to the plain key.
 */
export const PACKAGES = {
  'darwin-aarch64': 'Splitkick-aarch64.app.tar.gz',
  'windows-x86_64': 'Splitkick-x64-setup.exe',
}

/** The feed for the packages present in `folder` (signature beside each). */
export function manifestFor({ folder, version, tag, repository, pubDate }) {
  const platforms = {}
  for (const [key, asset] of Object.entries(PACKAGES)) {
    const signature = join(folder, `${asset}.sig`)
    if (!existsSync(join(folder, asset)) || !existsSync(signature)) continue
    platforms[key] = {
      signature: readFileSync(signature, 'utf8'),
      url: `https://github.com/${repository}/releases/download/${tag}/${asset}`,
    }
  }
  if (Object.keys(platforms).length === 0) return null
  return {
    version,
    notes: `Splitkick ${version}`,
    pub_date: pubDate,
    platforms,
  }
}

function main() {
  const folder = process.argv[2]
  const { VERSION, TAG, REPOSITORY } = process.env
  if (!folder || !VERSION || !TAG || !REPOSITORY) {
    console.error(
      'usage: VERSION=… TAG=… REPOSITORY=owner/repo node scripts/updater-manifest.mjs <folder>'
    )
    process.exit(2)
  }
  const manifest = manifestFor({
    folder,
    version: VERSION,
    tag: TAG,
    repository: REPOSITORY,
    pubDate: new Date().toISOString(),
  })
  if (!manifest) {
    console.log('No updater packages - no latest.json')
    return
  }
  writeFileSync(
    join(folder, 'latest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  console.log(Object.keys(manifest.platforms).join(' '))
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
