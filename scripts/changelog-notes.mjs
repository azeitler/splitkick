#!/usr/bin/env node
/**
 * Extracts the release notes for one version out of CHANGELOG.md.
 *
 * The changelog is written per commit and already says what changed and why,
 * so the GitHub release quotes it instead of repeating a generic paragraph.
 *
 * Run as `node scripts/changelog-notes.mjs 0.1.73-z.4`. The section body is
 * printed on stdout. A version with no section prints nothing and still exits
 * 0, so the caller can fall back to a commit list.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Heading that opens a version section, e.g. `## [0.1.73-z.4] - 2026-09-10`. */
const HEADING = /^## +\[([^\]]+)\]/

/**
 * The body of the `## [<version>]` section, without its heading.
 *
 * Stops at the next `## ` heading. Link-reference definitions are dropped:
 * they sit at the end of the file to serve the whole changelog, and GitHub
 * would render them as stray text in a release body.
 */
export function sectionFor(markdown, version) {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => {
    const match = HEADING.exec(line)
    return match !== null && match[1] === version
  })

  if (start === -1) return ''

  const rest = lines.slice(start + 1)
  const end = rest.findIndex(
    line => HEADING.test(line) || line.startsWith('## ')
  )
  const body = end === -1 ? rest : rest.slice(0, end)

  return body
    .filter(line => !/^\[[^\]]+\]: +\S+$/.test(line))
    .join('\n')
    .trim()
}

/** Every version that has a section, newest first as the file orders them. */
export function versionsIn(markdown) {
  return markdown
    .split('\n')
    .map(line => HEADING.exec(line))
    .filter(match => match !== null)
    .map(match => match[1])
}

function main() {
  const version = process.argv[2]

  if (!version) {
    console.error('Usage: node scripts/changelog-notes.mjs <version>')
    process.exit(1)
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const markdown = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
  const section = sectionFor(markdown, version)

  if (section) console.log(section)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
