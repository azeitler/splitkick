import { describe, expect, it } from 'vitest'
import { installGetComposedRangesCompat } from './selection-compat'

const root = { host: {}, mode: 'open' }
const range = { startContainer: 'text' }

/** WebKit before the spec change: shadow roots as rest arguments only. */
function oldWebKitSelection() {
  return {
    getComposedRanges(...roots: unknown[]) {
      if (
        roots.some(r => r === null || typeof r !== 'object' || !('host' in r))
      )
        throw new TypeError('Type error')
      return [range]
    },
  }
}

/** Current spec: one options dictionary. */
function newSelection() {
  return {
    getComposedRanges(options?: { shadowRoots?: unknown[] }) {
      return options?.shadowRoots ? [range] : []
    },
  }
}

describe('installGetComposedRangesCompat', () => {
  it('lets an options dictionary work on WebKit that only takes rest arguments', () => {
    const proto = oldWebKitSelection()
    expect(() =>
      proto.getComposedRanges({ shadowRoots: [root] } as never)
    ).toThrow(TypeError)

    installGetComposedRangesCompat(proto)

    expect(proto.getComposedRanges({ shadowRoots: [root] } as never)).toEqual([
      range,
    ])
    expect(proto.getComposedRanges({} as never)).toEqual([range])
  })

  it('leaves the rest-argument form alone', () => {
    const proto = oldWebKitSelection()
    installGetComposedRangesCompat(proto)
    expect(proto.getComposedRanges(root)).toEqual([range])
  })

  it('does not change a WebKit that takes the dictionary', () => {
    const proto = newSelection()
    installGetComposedRangesCompat(proto)
    expect(proto.getComposedRanges({ shadowRoots: [root] })).toEqual([range])
  })

  it('rethrows errors it cannot translate', () => {
    const proto = oldWebKitSelection()
    installGetComposedRangesCompat(proto)
    expect(() => proto.getComposedRanges('bad' as never)).toThrow(TypeError)
  })

  it('installs once and skips a missing method', () => {
    const proto = oldWebKitSelection()
    installGetComposedRangesCompat(proto)
    const patched = proto.getComposedRanges
    installGetComposedRangesCompat(proto)
    expect(proto.getComposedRanges).toBe(patched)
    expect(() => installGetComposedRangesCompat({})).not.toThrow()
    expect(() => installGetComposedRangesCompat(undefined)).not.toThrow()
  })
})
