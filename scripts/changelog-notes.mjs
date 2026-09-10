#!/usr/bin/env node
/**
 * Extracts the release notes for one version out of CHANGELOG.md.
 *
 * The changelog is written per commit and already says what changed and why,
 * so the GitHub release quotes it instead of repeating a generic paragraph.
 *
 * Run as `node scripts/changelog-notes.mjs 0.1.73-z.4`. The short form of the
 * section - one line per entry - is printed on stdout; add `--full` for the
 * whole section. A version with no section prints nothing and still exits 0,
 * so the caller can fall back to a commit list.
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

/** `[#21](https://...)` issue and pull request links inside an entry. */
const ISSUE_LINK = /\[#\d+\]\([^)\s]+\)/g

/**
 * The one-line form of a changelog entry: its bold headline, or the whole
 * first sentence when the headline stops mid-sentence ("**…on its row,**
 * after the timestamp."). Issue links anywhere in the entry are kept.
 */
function summarizeEntry(lines) {
  // The entry's own paragraph ends where its nested details begin.
  const nested = lines.findIndex((line, i) => i > 0 && /^\s+- /.test(line))
  const paragraph = (nested === -1 ? lines : lines.slice(0, nested))
    .map(line => line.trim())
    .join(' ')
    .replace(/^- /, '')

  const lead = /^\*\*(.+?)\*\*/.exec(paragraph)
  let summary
  if (lead && /[.!?]$/.test(lead[1])) {
    summary = lead[0]
  } else {
    const start = lead ? lead[0].length : 0
    const end = paragraph.slice(start).search(/[.!?](\s|$)/)
    summary = end === -1 ? paragraph : paragraph.slice(0, start + end + 1)
  }

  const links = [...new Set(lines.join(' ').match(ISSUE_LINK) ?? [])].filter(
    link => !summary.includes(link)
  )
  return links.length > 0
    ? `- ${summary} (${links.join(', ')})`
    : `- ${summary}`
}

/**
 * The short form of a section for a GitHub release: its `###` headings and one
 * line per entry. CHANGELOG.md keeps the detail; the release links to it.
 */
export function summarize(section) {
  const out = []
  let entry = null

  const flush = () => {
    if (entry) out.push(summarizeEntry(entry))
    entry = null
  }

  for (const line of section.split('\n')) {
    if (line.startsWith('### ')) {
      flush()
      if (out.length > 0) out.push('')
      out.push(line, '')
    } else if (line.startsWith('- ')) {
      flush()
      entry = [line]
    } else if (entry && (line.startsWith(' ') || line.trim() === '')) {
      entry.push(line)
    } else {
      // Text outside an entry, such as the "Built on Jean" preamble.
      flush()
    }
  }
  flush()

  return out.join('\n').trim()
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
  if (!section) return

  console.log(process.argv.includes('--full') ? section : summarize(section))
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
