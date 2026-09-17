import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('semantic brand and issue icons', () => {
  const source = readFileSync('src/components/icons/reicon.ts', 'utf8')

  it('maps Github to the GitHub brand icon instead of Code', () => {
    expect(source).toContain("export { GithubIcon as Github } from './GithubIcon'")
    expect(source).not.toContain('export { Code as Github }')
  })

  it('maps CircleDot to the issue icon instead of Radio', () => {
    expect(source).toContain("export { IssueIcon as CircleDot } from './IssueIcon'")
    expect(source).not.toContain('export { Radio as CircleDot }')
  })
})
