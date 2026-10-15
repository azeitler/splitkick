import assert from 'node:assert/strict'
import test from 'node:test'

import { cutChangelog, setOverlayVersion } from './release-cut.mjs'
import { sectionFor, summarize } from './changelog-notes.mjs'

const CHANGELOG = `# Changelog

All notable changes to Splitkick are recorded in this file.

## [Unreleased]

### Added

- **A new thing.** With detail.

### Fixed

- **An old thing.**

## [1.0.0] - 2026-10-20

Built on Jean 0.1.73.

### Fixed

- **Something earlier.**

[unreleased]: https://github.com/azeitler/splitkick/compare/splitkick-v1.0.0...HEAD
[1.0.0]: https://github.com/azeitler/splitkick/compare/splitkick-v1.0.0-rc.2...splitkick-v1.0.0
`

const OPTIONS = {
  version: '1.0.1',
  date: '2026-10-21',
  upstream: '0.1.73',
}

test('moves the Unreleased entries under the resolved version', () => {
  const cut = cutChangelog(CHANGELOG, OPTIONS)

  assert.match(cut, /## \[1\.0\.1\] - 2026-10-21\n\nBuilt on Jean 0\.1\.73\./)
  const section = sectionFor(cut, '1.0.1')
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
    summarize(sectionFor(cut, '1.0.1')),
    '### Added\n\n- **A new thing.**\n\n### Fixed\n\n- **An old thing.**'
  )
})

test('points the link references at the new version', () => {
  const cut = cutChangelog(CHANGELOG, OPTIONS)

  assert.match(
    cut,
    /^\[unreleased\]: https:\/\/github\.com\/azeitler\/splitkick\/compare\/splitkick-v1\.0\.1\.\.\.HEAD$/m
  )
  assert.match(
    cut,
    /^\[1\.0\.1\]: https:\/\/github\.com\/azeitler\/splitkick\/compare\/splitkick-v1\.0\.0\.\.\.splitkick-v1\.0\.1$/m
  )
  // The previous release's reference is untouched.
  assert.match(
    cut,
    /^\[1\.0\.0\]: \S+splitkick-v1\.0\.0-rc\.2\.\.\.splitkick-v1\.0\.0$/m
  )
})

test('refuses to cut a version that already has a section', () => {
  assert.throws(
    () => cutChangelog(CHANGELOG, { ...OPTIONS, version: '1.0.0' }),
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

test('sets the version in the overlay and keeps its formatting', () => {
  const json =
    '{\n  "productName": "Splitkick",\n  "version": "1.0.0",\n  "pos": { "x": 20, "y": 20 }\n}\n'
  const out = setOverlayVersion(json, '1.0.1')
  assert.equal(JSON.parse(out).version, '1.0.1')
  assert.equal(out, json.replace('"1.0.0"', '"1.0.1"'))
})
