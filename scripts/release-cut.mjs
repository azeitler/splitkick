#!/usr/bin/env node
/**
 * Cuts the `## [Unreleased]` section of CHANGELOG.md into a release and sets
 * the Splitkick version in src-tauri/tauri.fork.conf.json.
 *
 * The version is chosen by hand (semver, e.g. 1.0.1, 1.1.0, 1.1.0-rc.1) and
 * checked against the tags on `origin`: it must be new and newer than every
 * released version. Pushing the commit publishes it (see
 * scripts/splitkick-version.mjs); a version with an `-rc.N` suffix is
 * published as a GitHub pre-release, which the updater never offers.
 *
 *   bun run release:cut 1.0.1            # cut
 *   bun run release:cut 1.0.1 --dry-run  # print what it would do
 *   bun run release:cut 1.0.1 --force    # cut while a CI build is running
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compareVersions,
  listRemoteTags,
  parseVersion,
  previousTag,
  readUpstreamVersion,
  releasedVersions,
  tagFor,
} from './splitkick-version.mjs'

const REPO = 'azeitler/splitkick'
const UNRELEASED = '## [Unreleased]'

/** The `## [Unreleased]` body, or null when the heading is missing. */
function unreleasedBody(lines) {
  const start = lines.indexOf(UNRELEASED)
  if (start === -1) return null

  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * Rename `## [Unreleased]` to `version`, open a fresh empty Unreleased above
 * it, and move the `[unreleased]` link reference onto the new version.
 *
 * Throws when there is nothing to cut or the version already has a section —
 * both mean the caller is about to publish something other than it thinks.
 */
export function cutChangelog(markdown, { version, date, upstream }) {
  if (markdown.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`)
  }

  const lines = markdown.split('\n')
  const body = unreleasedBody(lines)
  if (body === null)
    throw new Error(`CHANGELOG.md has no ${UNRELEASED} heading`)
  if (!body.some(line => line.startsWith('- '))) {
    throw new Error(
      'The Unreleased section holds no entries — nothing to release'
    )
  }

  const cut = markdown.replace(
    `${UNRELEASED}\n`,
    `${UNRELEASED}\n\n## [${version}] - ${date}\n\nBuilt on Jean ${upstream}.\n`
  )

  // Link references sit at the end of the file and serve the whole changelog.
  const unreleasedRef = new RegExp(
    `^\\[unreleased\\]: (\\S+)\\.\\.\\.HEAD$`,
    'm'
  )
  const match = unreleasedRef.exec(cut)
  if (!match) return cut

  const tag = tagFor(version)
  const base = match[1].slice(0, match[1].lastIndexOf('/') + 1)
  return cut.replace(
    unreleasedRef,
    `[unreleased]: ${base}${tag}...HEAD\n[${version}]: ${match[1]}...${tag}`
  )
}

/**
 * Set `version` in the Splitkick overlay. Only that line changes, so the
 * file keeps its formatting.
 */
export function setOverlayVersion(json, version) {
  const line = /^(\s*"version":\s*)"[^"]*"/m
  if (!line.test(json)) {
    throw new Error('tauri.fork.conf.json has no "version" line')
  }
  return json.replace(line, `$1${JSON.stringify(version)}`)
}

/**
 * Where to look for `gh`. It is not always on PATH — the Jean desktop app ships
 * its own copy, and that is the one authenticated on a machine without a system
 * install. `GH_CLI` overrides both.
 */
function ghCandidates() {
  return [
    process.env.GH_CLI,
    'gh',
    resolve(
      homedir(),
      'Library/Application Support/app.splitkick.desktop/gh-cli/gh'
    ),
    resolve(
      homedir(),
      'Library/Application Support/com.jean.desktop/gh-cli/gh'
    ),
  ].filter(Boolean)
}

/**
 * Tag refs on `origin`, over SSH or — when the key is locked — over the API.
 *
 * Only the remote knows which numbers are taken. Local tags can be behind, and
 * cutting to a number another build already published is the mistake this
 * script exists to stop, so a resolver that cannot reach the remote refuses
 * instead of falling back to them.
 */
function remoteTags(cwd) {
  try {
    return listRemoteTags(cwd, { quiet: true })
  } catch {
    // `git ls-remote` needs the SSH key; an agent that has locked it fails
    // here while `gh`, which holds its own token, still works.
  }

  for (const gh of ghCandidates()) {
    try {
      const out = execFileSync(
        gh,
        ['api', '--paginate', `repos/${REPO}/tags`, '--jq', '.[].name'],
        { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      )
      return out.split('\n').filter(Boolean)
    } catch {
      // Try the next candidate.
    }
  }

  {
    console.error(
      'Cannot read the tags on origin: `git ls-remote` failed (SSH key locked?) ' +
        'and `gh api` did not work either.\n' +
        'Only the remote knows which version numbers are taken, so this refuses ' +
        'rather than cut to a number a build may already have published.\n' +
        'Unlock your SSH key, or authenticate gh, then run it again.'
    )
    process.exit(1)
  }
}

/** A CI build already running may publish before this cut lands. */
function runningBuild(cwd) {
  try {
    const out = execFileSync(
      'gh',
      [
        'run',
        'list',
        '--repo',
        REPO,
        '--workflow',
        'CI Build',
        '--limit',
        '1',
        '--json',
        'status,headSha,url',
      ],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const [run] = JSON.parse(out)
    if (!run) return null
    return run.status === 'in_progress' || run.status === 'queued' ? run : null
  } catch {
    // No gh, no auth, no network: the cut still works, it just cannot warn.
    return null
  }
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const dryRun = process.argv.includes('--dry-run')
  const force = process.argv.includes('--force')
  const version = process.argv.slice(2).find(arg => !arg.startsWith('--'))

  if (!version || !parseVersion(version)) {
    console.error(
      'Usage: bun run release:cut <version>   (e.g. 1.0.1 or 1.1.0-rc.1)'
    )
    process.exit(1)
  }

  const refs = remoteTags(root)
  const released = releasedVersions(refs)
  if (released.includes(version)) {
    console.error(`${tagFor(version)} already exists on origin.`)
    process.exit(1)
  }
  const newest = [...released].sort(compareVersions).pop()
  if (newest && compareVersions(version, newest) <= 0) {
    console.error(
      `${version} is not newer than the latest release ${newest}; the updater would never offer it.`
    )
    process.exit(1)
  }

  const running = runningBuild(root)
  if (running && !force) {
    console.error(
      `A CI Build is ${running.status} for ${running.headSha.slice(0, 7)}.\n` +
        `${running.url}\n\nWait for it to finish and run this again, or pass --force.`
    )
    process.exit(1)
  }

  const changelogPath = resolve(root, 'CHANGELOG.md')
  const overlayPath = resolve(root, 'src-tauri/tauri.fork.conf.json')
  let cut
  try {
    cut = cutChangelog(readFileSync(changelogPath, 'utf8'), {
      version,
      // Local date: a cut made after midnight belongs to that day, not to UTC's.
      date: new Date().toLocaleDateString('sv-SE'),
      upstream: readUpstreamVersion(root),
    })
  } catch (error) {
    // A refusal is an ordinary outcome here, not a crash to read a stack for.
    console.error(error.message)
    process.exit(1)
  }

  const previous = previousTag(refs, version)
  if (dryRun) {
    console.log(`Would cut ${version} (previous: ${previous ?? 'none'})`)
    return
  }

  writeFileSync(changelogPath, cut)
  writeFileSync(
    overlayPath,
    setOverlayVersion(readFileSync(overlayPath, 'utf8'), version)
  )
  console.log(
    `Cut ${version}. Review CHANGELOG.md, then commit and push to publish it.`
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
