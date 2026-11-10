import { afterEach, describe, expect, it } from 'vitest'
import { setAppSkeletonVisible } from './app-skeleton'

describe('setAppSkeletonVisible', () => {
  afterEach(() => document.getElementById('app-skeleton')?.remove())

  it('hides and shows the start skeleton', () => {
    const skeleton = document.createElement('div')
    skeleton.id = 'app-skeleton'
    document.body.append(skeleton)

    setAppSkeletonVisible(false)
    expect(skeleton.hidden).toBe(true)
    setAppSkeletonVisible(true)
    expect(skeleton.hidden).toBe(false)
  })

  it('does nothing without the skeleton (desktop app removes it)', () => {
    expect(() => setAppSkeletonVisible(false)).not.toThrow()
  })
})
