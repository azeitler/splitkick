import { describe, expect, it } from 'vitest'
import { isCodingProject, isVisibleProject } from './projects'

describe('isCodingProject', () => {
  it('follows git when the preset is automatic', () => {
    expect(isCodingProject({})).toBe(true)
    expect(isCodingProject({ is_git: true, preset: null })).toBe(true)
    expect(isCodingProject({ is_git: false })).toBe(false)
  })

  it('lets an explicit preset win over git', () => {
    expect(isCodingProject({ is_git: true, preset: 'non_coding' })).toBe(false)
    expect(isCodingProject({ is_git: false, preset: 'coding' })).toBe(true)
  })

  it('treats a missing project as coding', () => {
    expect(isCodingProject(undefined)).toBe(true)
  })
})

describe('isVisibleProject', () => {
  it('hides only the home of a global agent', () => {
    expect(isVisibleProject({ hidden: true })).toBe(false)
    expect(isVisibleProject({ hidden: false })).toBe(true)
    expect(isVisibleProject({})).toBe(true)
  })
})
