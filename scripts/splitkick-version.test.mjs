/**
 * Usage: node --test scripts/splitkick-version.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compareVersions,
  isPrerelease,
  previousTag,
  releasedVersions,
  shouldPublish,
  tagFor,
} from './splitkick-version.mjs'

const REFS = [
  'refs/tags/v1.0.11', // upstream Jean
  'refs/tags/v0.1.73-z.25', // JeanZ
  'refs/tags/splitkick-v1.0.0-rc.1',
  'refs/tags/splitkick-v1.0.0-rc.1^{}',
  'refs/tags/splitkick-v1.0.0',
  'refs/tags/splitkick-v1.0.1',
]

test('tags carry the splitkick-v prefix', () => {
  assert.equal(tagFor('1.2.3'), 'splitkick-v1.2.3')
})

test('only Splitkick tags count as released', () => {
  assert.deepEqual(releasedVersions(REFS), [
    '1.0.0-rc.1',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
  ])
})

test('semver precedence, including prereleases', () => {
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0)
  assert.ok(compareVersions('1.0.0-rc.10', '1.0.0-rc.9') > 0)
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0)
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0-rc') > 0)
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0)
  // Every Splitkick version is newer than every JeanZ version.
  assert.ok(compareVersions('1.0.0-rc.1', '0.1.73-z.25') > 0)
})

test('previous tag is the newest release below the version', () => {
  assert.equal(previousTag(REFS, '1.1.0'), 'splitkick-v1.0.1')
  assert.equal(previousTag(REFS, '1.0.0'), 'splitkick-v1.0.0-rc.1')
  assert.equal(previousTag(REFS, '1.0.0-rc.1'), null)
})

test('publishes only a new version with a changelog section', () => {
  const changelog = '## [Unreleased]\n\n## [1.1.0] - 2026-11-01\n'
  assert.equal(shouldPublish({ version: '1.1.0', refs: REFS, changelog }), true)
  assert.equal(
    shouldPublish({ version: '1.0.1', refs: REFS, changelog }),
    false,
    'already tagged'
  )
  assert.equal(
    shouldPublish({ version: '1.2.0', refs: REFS, changelog }),
    false,
    'no section'
  )
})

test('prereleases are recognised', () => {
  assert.equal(isPrerelease('1.0.0-rc.2'), true)
  assert.equal(isPrerelease('1.0.0'), false)
})
