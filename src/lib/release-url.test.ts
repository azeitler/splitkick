import { describe, expect, it } from 'vitest'

import {
  FORK_REPO_URL,
  UPSTREAM_REPO_URL,
  isForkVersion,
  releaseUrlForVersion,
  repoUrlForVersion,
} from './release-url'

describe('releaseUrlForVersion', () => {
  it('sends a JeanZ version to the fork, which is the only place it is tagged', () => {
    expect(releaseUrlForVersion('0.1.73-z.1')).toBe(
      `${FORK_REPO_URL}/releases/tag/v0.1.73-z.1`
    )
    expect(releaseUrlForVersion('0.74.0-z.12')).toBe(
      `${FORK_REPO_URL}/releases/tag/v0.74.0-z.12`
    )
  })

  it('leaves an upstream version pointing at upstream', () => {
    expect(releaseUrlForVersion('0.1.73')).toBe(
      `${UPSTREAM_REPO_URL}/releases/tag/v0.1.73`
    )
  })

  it('treats another prerelease as upstream, because the fork only uses -z.<n>', () => {
    expect(repoUrlForVersion('0.1.73-rc.1')).toBe(UPSTREAM_REPO_URL)
    expect(repoUrlForVersion('0.1.73-beta')).toBe(UPSTREAM_REPO_URL)
    // The undotted form is not a version this fork ever produces.
    expect(repoUrlForVersion('0.1.73-z1')).toBe(UPSTREAM_REPO_URL)
  })

  it('recognises a fork version regardless of surrounding whitespace', () => {
    expect(isForkVersion(' 0.1.73-z.9 ')).toBe(true)
    expect(releaseUrlForVersion(' 0.1.73-z.9 ')).toBe(
      `${FORK_REPO_URL}/releases/tag/v0.1.73-z.9`
    )
  })

  it('does not build a link with an empty version', () => {
    expect(repoUrlForVersion('')).toBe(UPSTREAM_REPO_URL)
  })
})
