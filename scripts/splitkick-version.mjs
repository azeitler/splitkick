#!/usr/bin/env node
/**
 * The Splitkick release version and whether a build should publish it.
 *
 * The version lives in src-tauri/tauri.fork.conf.json (`version`), set by
 * `bun run release:cut <version>`. Splitkick uses plain semver (1.0.0,
 * 1.0.1, 1.1.0-rc.1), independent of the upstream Jean version it is built
 * on, which stays in the untouched base src-tauri/tauri.conf.json.
 *
 * Tags are `splitkick-v<version>`. The prefix keeps them apart from upstream
 * Jean's `v<version>` tags, which a checkout with the upstream remote fetches.
 *
 * A push to main publishes only when the version has a CHANGELOG.md section
 * and no tag yet, so ordinary pushes build and test without releasing.
 *
 * Run without arguments to print `upstream=`, `version=`, `tag=`,
 * `previous=`, `prerelease=` and `publish=` lines for $GITHUB_OUTPUT.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TAG_PREFIX = 'splitkick-v'

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/** Parsed semver, or null. */
export function parseVersion(version) {
  const match = SEMVER.exec(version.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  }
}

/** Semver precedence: negative when a < b. */
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`Not a semver version: ${!x ? a : b}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] !== y[key]) return x[key] - y[key]
  }
  // A prerelease sorts below the plain version.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

export function isPrerelease(version) {
  return (parseVersion(version)?.pre.length ?? 0) > 0
}

export function tagFor(version) {
  return `${TAG_PREFIX}${version}`
}

/** Splitkick versions that already have a tag, from `git ls-remote` refs or tag names. */
export function releasedVersions(refs) {
  return refs
    .map(ref =>
      ref
        .trim()
        .replace(/^refs\/tags\//, '')
        .replace(/\^\{\}$/, '')
    )
    .filter(name => name.startsWith(TAG_PREFIX))
    .map(name => name.slice(TAG_PREFIX.length))
    .filter(version => parseVersion(version))
}

/** Tag of the newest release below `version`, or null. */
export function previousTag(refs, version) {
  const older = releasedVersions(refs)
    .filter(v => compareVersions(v, version) < 0)
    .sort(compareVersions)
  return older.length ? tagFor(older[older.length - 1]) : null
}

/** Whether a push of this version should publish a release. */
export function shouldPublish({ version, refs, changelog }) {
  if (releasedVersions(refs).includes(version)) return false
  return changelog.includes(`## [${version}]`)
}

export function readVersion(root) {
  const overlay = JSON.parse(
    readFileSync(resolve(root, 'src-tauri/tauri.fork.conf.json'), 'utf8')
  )
  if (!parseVersion(overlay.version ?? '')) {
    throw new Error(
      `src-tauri/tauri.fork.conf.json has no valid version: ${overlay.version}`
    )
  }
  return overlay.version
}

export function readUpstreamVersion(root) {
  return JSON.parse(
    readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')
  ).version
}

/**
 * Tag refs on `origin`, read live — the only source that knows what is taken.
 * `quiet` hides git's stderr for a caller with a second way to read the tags.
 */
export function listRemoteTags(cwd, { quiet = false } = {}) {
  const output = execFileSync('git', ['ls-remote', '--tags', 'origin'], {
    cwd,
    encoding: 'utf8',
    ...(quiet ? { stdio: ['ignore', 'pipe', 'ignore'] } : {}),
  })
  // Every line is `<sha>\t<ref>`.
  return output.split('\n').map(line => line.split('\t')[1] ?? '')
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const version = readVersion(root)
  const refs = listRemoteTags(root)
  const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')

  console.log(`upstream=${readUpstreamVersion(root)}`)
  console.log(`version=${version}`)
  console.log(`tag=${tagFor(version)}`)
  console.log(`previous=${previousTag(refs, version) ?? ''}`)
  console.log(`prerelease=${isPrerelease(version)}`)
  console.log(`publish=${shouldPublish({ version, refs, changelog })}`)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
