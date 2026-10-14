import { describe, expect, it } from 'vitest'

import {
  REPO_URL,
  isJeanzVersion,
  releaseUrlForVersion,
  tagForVersion,
} from './release-url'

describe('releaseUrlForVersion', () => {
  it('links a Splitkick version to its prefixed tag', () => {
    expect(releaseUrlForVersion('1.0.0')).toBe(
      `${REPO_URL}/releases/tag/splitkick-v1.0.0`
    )
    expect(tagForVersion('1.0.0-rc.1')).toBe('splitkick-v1.0.0-rc.1')
  })

  it('links an old JeanZ version to its plain v tag', () => {
    expect(releaseUrlForVersion(' 0.1.73-z.9 ')).toBe(
      `${REPO_URL}/releases/tag/v0.1.73-z.9`
    )
    expect(isJeanzVersion('0.1.73-z1')).toBe(false)
  })
})
