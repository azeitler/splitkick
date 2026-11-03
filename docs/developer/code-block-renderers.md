# Code-block renderers

Fenced code blocks in `Markdown` (`src/components/ui/markdown.tsx`) can render
as something richer than code: Mermaid diagrams today, more later. Chat
messages, plan views and Markdown file previews all use `Markdown`, so a
renderer works in all of them.

## Registry

`src/components/ui/code-block-renderers.ts`:

```ts
export interface CodeBlockRenderer {
  languages: string[] // fence languages, lower case
  mode: 'auto' | 'preview'
  load: () => Promise<{
    default: ComponentType<{ code: string; isComplete: boolean }>
  }>
}
export const codeBlockRenderers: CodeBlockRenderer[] = [
  /* one entry per feature */
]
export function findCodeBlockRenderer(
  language: string | undefined
): CodeBlockRenderer | undefined
```

- `auto`: the block renders in place (diagrams, charts).
- `preview`: the code block stays and gets a Preview action (HTML/SVG).
- `load` must be a dynamic `import()`. The renderer and its library go into
  their own chunks and load only when a matching block is shown, so the main
  bundle does not grow.

## How Markdown uses it

`PreBlock` in `markdown.tsx` reads the language from the `language-*` class,
looks it up, and for an `auto` entry renders the lazy component inside
`<Suspense>`, with the normal code block as the fallback. A chunk that fails to
load shows the normal code block.

`isComplete` is `false` while a message streams and the block has no closing
fence yet. Renderers show the source until it is `true`.

## Shared chrome

`src/components/ui/rich-blocks/RichBlockFrame.tsx` gives a renderer its
toolbar (source toggle, full screen with zoom/pan, copy source, copy as SVG,
copy as PNG) and the error view (error message above the source). Pass it the
source, the rendered SVG markup and an error. `useIsDarkTheme()` follows the
`dark` class on `<html>`; re-render when it changes.

## Mermaid

`src/components/ui/rich-blocks/MermaidBlock.tsx`. Mermaid loads on the first
diagram. Renders are queued, because `mermaid.initialize()` (theme) is global.
Settings: `securityLevel: 'strict'`, `theme: 'default' | 'dark'`,
`htmlLabels: false` (SVG text, so the PNG copy can draw the SVG on a canvas
without tainting it). `mermaid.parse()` runs first to get a readable error.

Docs: <https://mermaid.js.org/config/usage.html>,
<https://mermaid.js.org/config/schema-docs/config.html>, Mermaid 12 release
notes: <https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.0.0>.

Mermaid 12 targets Safari 17.4+ / ES2024. On an older WebKit the import or
render fails and the block shows the source with the error.

## Adding a renderer

1. Put the component in `src/components/ui/rich-blocks/<Name>Block.tsx` with a
   default export taking `{ code, isComplete }`.
2. Add an entry to `codeBlockRenderers`.
3. Test with `vi.mock()` of the heavy library (see `MermaidBlock.test.tsx`).
