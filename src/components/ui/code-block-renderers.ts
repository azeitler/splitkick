import type { ComponentType } from 'react'

/**
 * Registry of rich renderers for fenced code blocks, keyed by language.
 * `Markdown` looks up each fenced block here; see
 * docs/developer/code-block-renderers.md.
 *
 * - `auto`: the block renders in place (diagrams, charts). The normal code
 *   block shows while the renderer loads.
 * - `preview`: the code block stays and gets a Preview action (HTML/SVG).
 *
 * `load` must be a dynamic import, so a renderer and its library only load
 * when a matching block is shown.
 */
export interface CodeBlockRenderer {
  languages: string[]
  mode: 'auto' | 'preview'
  load: () => Promise<{
    default: ComponentType<{ code: string; isComplete: boolean }>
  }>
}

export const codeBlockRenderers: CodeBlockRenderer[] = [
  {
    languages: ['mermaid'],
    mode: 'auto',
    load: () => import('@/components/ui/rich-blocks/MermaidBlock'),
  },
  {
    languages: ['vega-lite'],
    mode: 'auto',
    load: () => import('@/components/ui/rich-blocks/VegaLiteBlock'),
  },
  {
    languages: ['html', 'svg'],
    mode: 'preview',
    load: () => import('@/components/ui/rich-blocks/HtmlPreviewBlock'),
  },
]

export function findCodeBlockRenderer(
  language: string | undefined
): CodeBlockRenderer | undefined {
  if (!language) return undefined
  const lang = language.toLowerCase()
  return codeBlockRenderers.find(renderer => renderer.languages.includes(lang))
}
