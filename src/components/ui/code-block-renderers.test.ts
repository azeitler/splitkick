import { describe, expect, it } from 'vitest'
import {
  codeBlockRenderers,
  findCodeBlockRenderer,
} from './code-block-renderers'

describe('findCodeBlockRenderer', () => {
  it('finds the Mermaid renderer, in any case', () => {
    const mermaid = codeBlockRenderers.find(r =>
      r.languages.includes('mermaid')
    )
    expect(mermaid?.mode).toBe('auto')
    expect(findCodeBlockRenderer('mermaid')).toBe(mermaid)
    expect(findCodeBlockRenderer('Mermaid')).toBe(mermaid)
  })

  it('returns undefined for other or missing languages', () => {
    expect(findCodeBlockRenderer('ts')).toBeUndefined()
    expect(findCodeBlockRenderer('')).toBeUndefined()
    expect(findCodeBlockRenderer(undefined)).toBeUndefined()
  })
})
