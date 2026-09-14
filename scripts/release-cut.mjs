#!/usr/bin/env node
/**
 * Cuts the `## [Unreleased]` section of CHANGELOG.md into the version the next
 * build will actually publish.
 *
 * Naming that version by hand is how z.8 and z.9 both lost their notes: the
 * section was written as z.8 while a build of an earlier commit was already in
 * flight, so that build took the number and the next push became z.9 with no
 * section of its own. Both releases fell back to raw commit subjects.
 *
 * So the version is never typed here. It is resolved the same way CI resolves
 * it, from the tags on `origin`, at the moment of the cut — and a build that is
 * already running is reported, because it will take the number first.
 *
 *   bun run release:cut            # cut, after checking for a running build
 *   bun run release:cut --dry-run  # print what it would do
 *   bun run release:cut --force    # cut anyway while a build is running
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { listRemoteTags, nextVersion, previousTag } from './jeanz-version.mjs'

const REPO = 'azeitler/jean'
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
export function cutChangelog(
  markdown,
  { version, date, previousVersion, upstream }
) {
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

  const preamble = previousVersion
    ? `Built on Jean ${upstream}.`
    : `Built on Jean ${upstream}. JeanZ versions carry a \`-z.<n>\` suffix; the counter is this fork's own and never restarts.`

  const cut = markdown.replace(
    `${UNRELEASED}\n`,
    `${UNRELEASED}\n\n## [${version}] - ${date}\n\n${preamble}\n`
  )

  // Link references sit at the end of the file and serve the whole changelog.
  const unreleasedRef = new RegExp(
    `^\\[unreleased\\]: (\\S+)\\.\\.\\.HEAD$`,
    'm'
  )
  const match = unreleasedRef.exec(cut)
  if (!match) return cut

  const base = match[1].slice(0, match[1].lastIndexOf('/') + 1)
  return cut.replace(
    unreleasedRef,
    `[unreleased]: ${base}v${version}...HEAD\n[${version}]: ${match[1]}...v${version}`
  )
}

/** A CI build already running will take the next number before this cut does. */
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

  const { version: upstream } = JSON.parse(
    readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')
  )
  const refs = listRemoteTags(root)
  const version = nextVersion(upstream, refs)
  const previous = previousTag(refs)

  const running = runningBuild(root)
  if (running && !force) {
    console.error(
      `A CI Build is ${running.status} for ${running.headSha.slice(0, 7)}.\n` +
        `It will publish ${version} before your push does, so this cut would ` +
        `name the wrong release.\n${running.url}\n\n` +
        'Wait for it to finish and run this again, or pass --force.'
    )
    process.exit(1)
  }

  const path = resolve(root, 'CHANGELOG.md')
  let cut
  try {
    cut = cutChangelog(readFileSync(path, 'utf8'), {
      version,
      date: new Date().toISOString().slice(0, 10),
      previousVersion: previous,
      upstream,
    })
  } catch (error) {
    // A refusal is an ordinary outcome here, not a crash to read a stack for.
    console.error(error.message)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`Would cut ${version} (previous: ${previous ?? 'none'})`)
    return
  }

  writeFileSync(path, cut)
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
