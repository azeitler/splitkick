#!/usr/bin/env node
/**
 * Lists user-visible "Jean" / "JeanZ" text left in the source.
 *
 * Splitkick is built on Jean. After an upstream merge, new upstream strings
 * name the product "Jean"; this check finds them so they can be switched to
 * `PRODUCT_NAME` (TS, '@/lib/build-info') or "Splitkick" (Rust). Identifiers
 * such as `JeanMcpSection` do not match (no word boundary), and comments and
 * tests are skipped.
 *
 * A line that must keep the name (the upstream credit, the import source,
 * upstream's `jean-server`) ends with the marker `brand-ok`, or matches an
 * entry in ALLOW below.
 *
 * Usage: node scripts/check-branding.mjs   (exit 1 when anything is found)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ROOTS = [
  ['src', /\.(ts|tsx)$/],
  ['jean-core/src', /\.rs$/],
  ['src-tauri/src', /\.rs$/],
]

const SKIP_FILE = /(\.test\.tsx?$|\/test\/|\/tests?\.rs$|_tests?\.rs$)/

// Files about Jean itself: the import of a Jean data folder.
const ALLOW_FILES = new Set([
  'jean-core/src/jean_import.rs',
  'src/components/onboarding/ImportFromJeanDialog.tsx',
])

const NAME = /\bJean(Z)?\b/

// Text that names upstream Jean on purpose.
const ALLOW = [
  /Built on Jean/,
  /coollabsio\/jean/,
  /\bJean server\b/,
  /brand-ok/,
]

function* files(dir, pattern) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      yield* files(path, pattern)
    } else if (pattern.test(entry)) {
      yield path
    }
  }
}

function isComment(line) {
  const t = line.trim()
  return (
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('{/*')
  )
}

const hits = []
for (const [dir, pattern] of ROOTS) {
  for (const path of files(join(root, dir), pattern)) {
    const rel = relative(root, path)
    if (SKIP_FILE.test(rel) || ALLOW_FILES.has(rel)) continue
    const lines = readFileSync(path, 'utf8').split('\n')
    // A top-level `#[cfg(test)] mod … {` runs until its closing `}` at column 0.
    let inRustTests = false
    lines.forEach((line, index) => {
      if (rel.endsWith('.rs')) {
        if (
          /^#\[cfg\(test\)\]/.test(line) &&
          /^(pub(\(crate\))? )?mod \w+ \{/.test(lines[index + 1] ?? '')
        ) {
          inRustTests = true
          return
        }
        if (inRustTests) {
          if (line === '}') inRustTests = false
          return
        }
      }
      if (isComment(line)) return
      // Strip a trailing line comment so `foo(); // Jean` does not count.
      const code = line.replace(/\s\/\/\s.*$/, '')
      if (!NAME.test(code)) return
      if (ALLOW.some(allow => allow.test(line))) return
      hits.push(`${rel}:${index + 1}: ${line.trim()}`)
    })
  }
}

if (hits.length > 0) {
  console.error(`User-visible "Jean" text found (${hits.length}):\n`)
  console.error(hits.join('\n'))
  console.error(
    '\nUse PRODUCT_NAME / "Splitkick", or end the line with `brand-ok`.'
  )
  process.exit(1)
}
console.log('check-branding: no user-visible "Jean" text')
