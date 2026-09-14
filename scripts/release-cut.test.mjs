import assert from 'node:assert/strict'
import test from 'node:test'

import { cutChangelog } from './release-cut.mjs'
import { sectionFor, summarize } from './changelog-notes.mjs'

const CHANGELOG = `# Changelog

All notable changes to Jean are recorded in this file.

## [Unreleased]

### Added

- **A new thing.** With detail.

### Fixed

- **An old thing.**

## [0.1.73-z.9] - 2026-09-14

Built on Jean 0.1.73.

### Fixed

- **Something earlier.**

[unreleased]: https://github.com/azeitler/jean/compare/v0.1.73-z.9...HEAD
[0.1.73-z.9]: https://github.com/azeitler/jean/compare/v0.1.73-z.8...v0.1.73-z.9
`

const OPTIONS = {
  version: '0.1.73-z.10',
  date: '2026-09-15',
  previousVersion: 'v0.1.73-z.9',
  upstream: '0.1.73',
}

test('moves the Unreleased entries under the resolved version', () => {
  const cut = cutChangelog(CHANGELOG, OPTIONS)

  assert.match(cut, /## \[0\.1\.73-z\.10\] - 2026-09-15/)
  const section = sectionFor(cut, '0.1.73-z.10')
  assert.match(section, /\*\*A new thing\.\*\*/)
  assert.match(section, /\*\*An old thing\.\*\*/)
  // The older release keeps its own entry.
  assert.doesNotMatch(section, /Something earlier/)
})

test('leaves an empty Unreleased section behind for the next change', () => {
  const cut = cutChangelog(CHANGELOG, OPTIONS)

  assert.match(cut, /## \[Unreleased\]/)
  assert.equal(sectionFor(cut, 'Unreleased'), '')
})

test('the cut section is what the release notes will quote', () => {
  const cut = cutChangelog(CHANGELOG, OPTIONS)

  assert.equal(
    summarize(sectionFor(cut, '0.1.73-z.10')),
    '### Added\n\n- **A new thing.**\n\n### Fixed\n\n- **An old thing.**'
  )
})

test('points the link references at the new version', () => {
  const cut = cutChangelog(CHANGELOG, OPTIONS)

  assert.match(
    cut,
    /^\[unreleased\]: https:\/\/github\.com\/azeitler\/jean\/compare\/v0\.1\.73-z\.10\.\.\.HEAD$/m
  )
  assert.match(
    cut,
    /^\[0\.1\.73-z\.10\]: https:\/\/github\.com\/azeitler\/jean\/compare\/v0\.1\.73-z\.9\.\.\.v0\.1\.73-z\.10$/m
  )
  // The previous release's reference is untouched.
  assert.match(
    cut,
    /^\[0\.1\.73-z\.9\]: \S+v0\.1\.73-z\.8\.\.\.v0\.1\.73-z\.9$/m
  )
})

test('refuses to cut a version that already has a section', () => {
  assert.throws(
    () => cutChangelog(CHANGELOG, { ...OPTIONS, version: '0.1.73-z.9' }),
    /already has a section/
  )
})

test('refuses to cut an Unreleased section with no entries', () => {
  const empty = CHANGELOG.replace(
    '### Added\n\n- **A new thing.** With detail.\n\n### Fixed\n\n- **An old thing.**\n',
    ''
  )

  assert.throws(() => cutChangelog(empty, OPTIONS), /nothing to release/)
})

test('refuses a changelog with no Unreleased heading', () => {
  assert.throws(
    () => cutChangelog(CHANGELOG.replace('## [Unreleased]\n', ''), OPTIONS),
    /no ## \[Unreleased\] heading/
  )
})

test('cutting twice in a row is refused, not silently repeated', () => {
  const once = cutChangelog(CHANGELOG, OPTIONS)

  assert.throws(() => cutChangelog(once, OPTIONS), /already has a section/)
})
