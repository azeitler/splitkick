import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { sectionFor, summarize, versionsIn } from './changelog-notes.mjs'

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Something not shipped yet.

## [0.1.73-z.4] - 2026-09-10

### Added

- **A real feature.** With a second line.
  - And a nested point.

### Fixed

- **A real fix.**

## [0.1.73-z.3] - 2026-09-09

### Fixed

- An older fix.

[unreleased]: https://github.com/azeitler/jean/compare/v0.1.73-z.4...HEAD
[0.1.73-z.4]: https://github.com/azeitler/jean/compare/v0.1.73-z.3...v0.1.73-z.4
`

test('reads one version section without its heading', () => {
  const section = sectionFor(CHANGELOG, '0.1.73-z.4')

  assert.match(section, /### Added/)
  assert.match(section, /\*\*A real feature\.\*\*/)
  assert.match(section, /- And a nested point\./)
  assert.match(section, /\*\*A real fix\.\*\*/)
})

test('stops at the next version and never bleeds into a neighbour', () => {
  const section = sectionFor(CHANGELOG, '0.1.73-z.4')

  assert.doesNotMatch(section, /Something not shipped yet/)
  assert.doesNotMatch(section, /An older fix/)
  assert.doesNotMatch(section, /## \[/)
})

test('drops the link reference definitions at the end of the file', () => {
  const section = sectionFor(CHANGELOG, '0.1.73-z.3')

  assert.match(section, /An older fix/)
  assert.doesNotMatch(section, /compare/)
  assert.doesNotMatch(section, /^\[/m)
})

test('an unknown version yields an empty string, so the caller can fall back', () => {
  assert.equal(sectionFor(CHANGELOG, '9.9.9-z.99'), '')
  // The tag carries a leading v; the heading does not. The caller strips it.
  assert.equal(sectionFor(CHANGELOG, 'v0.1.73-z.4'), '')
})

test('lists the versions in file order', () => {
  assert.deepEqual(versionsIn(CHANGELOG), [
    'Unreleased',
    '0.1.73-z.4',
    '0.1.73-z.3',
  ])
})

test('the real changelog has a section for the version being released next', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const markdown = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
  const { version } = JSON.parse(
    readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')
  )

  // Every shipped section is <upstream>-z.<n>, so at least one has to match the
  // upstream version in the config. A release whose notes were never written
  // would otherwise fall back to a bare commit list without anyone noticing.
  const shipped = versionsIn(markdown).filter(name => name !== 'Unreleased')

  assert.ok(
    shipped.some(name => name.startsWith(`${version}-z.`)),
    `No CHANGELOG.md section for upstream ${version}; found ${shipped.join(', ')}`
  )
})

const DETAILED = `Built on Jean 0.1.73.

### Added

- **Chat: links open in the embedded browser.** Click a link in a reply,
  and Jean shows the page. ([#21](https://github.com/azeitler/jean/issues/21))
  - Web links open in the embedded browser.
  - A small button opens the system browser.
- **Sidebar: a label comes last on its row,** after the activity
  timestamp.

### Fixed

- **A star always shows.** A star on a new session was saved but never
  shown.
`

test('summarize keeps one line per entry under its heading', () => {
  assert.equal(
    summarize(DETAILED),
    [
      '### Added',
      '',
      '- **Chat: links open in the embedded browser.** ([#21](https://github.com/azeitler/jean/issues/21))',
      '- **Sidebar: a label comes last on its row,** after the activity timestamp.',
      '',
      '### Fixed',
      '',
      '- **A star always shows.**',
    ].join('\n')
  )
})

test('summarize drops nested details and the preamble', () => {
  const summary = summarize(DETAILED)

  assert.doesNotMatch(summary, /Built on Jean/)
  assert.doesNotMatch(summary, /system browser/)
  // [ \t], not \s: \s also matches the newline before a top-level bullet.
  assert.doesNotMatch(summary, /^[ \t]+- /m)
})

test('summarize uses the first sentence when an entry has no bold headline', () => {
  assert.equal(
    summarize('### Fixed\n\n- The tab bar is named. It was not before.\n'),
    '### Fixed\n\n- The tab bar is named.'
  )
})

test('every entry of the real release sections becomes one summary line', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const markdown = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')

  for (const version of versionsIn(markdown).filter(v => v !== 'Unreleased')) {
    const section = sectionFor(markdown, version)
    const entries = section.split('\n').filter(line => line.startsWith('- '))
    const lines = summarize(section)
      .split('\n')
      .filter(line => line.startsWith('- '))

    assert.equal(lines.length, entries.length, version)
  }
})
