import { afterEach, describe, expect, it } from 'vitest'
import { setAppSkeletonStep, setAppSkeletonVisible } from './app-skeleton'

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

describe('setAppSkeletonStep', () => {
  afterEach(() => document.getElementById('app-skeleton')?.remove())

  it('names the step and drops the slow-download hint', () => {
    const skeleton = document.createElement('div')
    skeleton.id = 'app-skeleton'
    skeleton.innerHTML = '<p class="sk-step" hidden></p><p class="sk-hint"></p>'
    document.body.append(skeleton)

    setAppSkeletonStep('loadingProjects')

    const step = skeleton.querySelector<HTMLElement>('.sk-step')
    expect(step?.hidden).toBe(false)
    expect(step?.textContent).toBe('Loading projects…')
    expect(skeleton.querySelector<HTMLElement>('.sk-hint')?.hidden).toBe(true)

    setAppSkeletonStep('connecting')
    expect(step?.textContent).toBe('Connecting…')
  })

  it('does nothing without the skeleton (desktop app removes it)', () => {
    expect(() => setAppSkeletonStep('connecting')).not.toThrow()
  })
})
