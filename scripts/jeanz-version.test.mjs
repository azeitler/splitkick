import assert from 'node:assert/strict'
import test from 'node:test'

import { highestSequence, nextVersion } from './jeanz-version.mjs'

test('starts at z.1 when no JeanZ tag exists', () => {
  assert.equal(nextVersion('0.1.73', []), '0.1.73-z.1')
  assert.equal(nextVersion('0.1.73', ['v0.1.72', 'main-build']), '0.1.73-z.1')
})

test('continues the counter across upstream versions', () => {
  const tags = ['v0.68.1-z.1', 'v0.68.1-z.2', 'v0.70.0-z.3', 'v0.74.0-z.4']

  assert.equal(nextVersion('0.74.0', tags), '0.74.0-z.5')
  // The upstream version moved on, the counter does not restart.
  assert.equal(nextVersion('0.75.0', tags), '0.75.0-z.5')
})

test('reads the highest suffix, not the last or the longest', () => {
  assert.equal(highestSequence(['v1.0.0-z.9', 'v1.0.0-z.10', 'v1.0.0-z.2']), 10)
})

test('accepts full refs and the peeled refs of annotated tags', () => {
  const refs = [
    'refs/tags/v0.1.73-z.6',
    'refs/tags/v0.1.73-z.6^{}',
    'refs/tags/v0.1.73',
    '',
  ]

  assert.equal(highestSequence(refs), 6)
})

test('ignores tags that only look like JeanZ tags', () => {
  const refs = [
    // The undotted form sorts wrong in semver, so it is not a JeanZ tag.
    'v0.1.73-z4',
    'v0.1.73-z.',
    'v0.1.73-z.zebra',
    'v0.1.73-rc.1',
    'v0.1-z.4',
    'z.7',
    'jeanz-8',
  ]

  assert.equal(highestSequence(refs), 0)
})

test('refuses an upstream version that is not X.Y.Z', () => {
  assert.throws(() => nextVersion('0.1.73-z.1', []), /must look like 1\.2\.3/)
  assert.throws(() => nextVersion('0.1', []), /must look like 1\.2\.3/)
})

/**
 * The reason for the dot. The updater only offers an update when the remote
 * version is semver-greater than the installed one. Semver compares a
 * prerelease identifier that contains a letter as ASCII text, so an undotted
 * "z10" would sort below "z9" and updates would stop at the tenth build.
 */
test('every build sorts above the one before it, past ten', () => {
  const versions = Array.from({ length: 40 }, (_, index) =>
    nextVersion(
      '0.1.73',
      Array.from({ length: index }, (_, n) => `v0.1.73-z.${n + 1}`)
    )
  )

  for (let index = 1; index < versions.length; index += 1) {
    assert.ok(
      compareSemver(versions[index], versions[index - 1]) > 0,
      `${versions[index]} must sort above ${versions[index - 1]}`
    )
  }
})

/** Minimal semver precedence, limited to what these versions use. */
function compareSemver(a, b) {
  const [coreA, preA] = a.split('-')
  const [coreB, preB] = b.split('-')

  const numbersA = coreA.split('.').map(Number)
  const numbersB = coreB.split('.').map(Number)

  for (let index = 0; index < 3; index += 1) {
    if (numbersA[index] !== numbersB[index]) {
      return numbersA[index] - numbersB[index]
    }
  }

  const identifiersA = preA.split('.')
  const identifiersB = preB.split('.')

  for (let index = 0; index < identifiersA.length; index += 1) {
    const left = identifiersA[index]
    const right = identifiersB[index]

    if (left === right) continue
    if (right === undefined) return 1

    const bothNumeric = /^\d+$/.test(left) && /^\d+$/.test(right)

    return bothNumeric ? Number(left) - Number(right) : left < right ? -1 : 1
  }

  return identifiersA.length - identifiersB.length
}
