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

  it('maps vega-lite to the lazily loaded chart renderer', async () => {
    const renderer = findCodeBlockRenderer('vega-lite')
    expect(renderer?.mode).toBe('auto')
    expect(findCodeBlockRenderer('Vega-Lite')).toBe(renderer)
    const module = await renderer?.load()
    expect(typeof module?.default).toBe('function')
  })

  it('returns undefined for other or missing languages', () => {
    expect(findCodeBlockRenderer('ts')).toBeUndefined()
    expect(findCodeBlockRenderer('chart')).toBeUndefined()
    expect(findCodeBlockRenderer('')).toBeUndefined()
    expect(findCodeBlockRenderer(undefined)).toBeUndefined()
  })
})
