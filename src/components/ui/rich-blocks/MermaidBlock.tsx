import { useEffect, useState } from 'react'
import { RichBlockFrame, useIsDarkTheme } from './RichBlockFrame'

let renderCount = 0
let renderQueue: Promise<unknown> = Promise.resolve()

/**
 * Render Mermaid source to SVG markup. Mermaid loads on the first call.
 * Docs: https://mermaid.js.org/config/usage.html (render, parse) and
 * https://mermaid.js.org/config/schema-docs/config.html (securityLevel, theme,
 * htmlLabels).
 */
async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    // Sanitizes labels and disables click handlers and scripts.
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    // SVG text instead of <foreignObject> HTML, so "Copy as PNG" can draw the
    // diagram on a canvas without tainting it.
    htmlLabels: false,
  })
  // parse() throws a readable error and leaves nothing in the DOM.
  await mermaid.parse(code)
  const id = `splitkick-mermaid-${++renderCount}`
  try {
    const { svg } = await mermaid.render(id, code)
    return svg
  } finally {
    // render() works in a temporary element; drop it if an error left it.
    document.getElementById(`d${id}`)?.remove()
  }
}

/** One render at a time: initialize() sets the theme for the whole library. */
function queueRender(code: string, dark: boolean): Promise<string> {
  const run = renderQueue.then(() => renderMermaid(code, dark))
  renderQueue = run.catch(() => undefined)
  return run
}

interface RenderResult {
  svg?: string
  error?: string
}

/** A ```mermaid block: the diagram once the block is complete. */
export default function MermaidBlock({
  code,
  isComplete,
}: {
  code: string
  isComplete: boolean
}) {
  const dark = useIsDarkTheme()
  const [result, setResult] = useState<RenderResult | null>(null)

  useEffect(() => {
    if (!isComplete) return
    let cancelled = false
    queueRender(code, dark).then(
      svg => {
        if (!cancelled) setResult({ svg })
      },
      (err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setResult({ error: message || 'Unknown error' })
      }
    )
    return () => {
      cancelled = true
    }
  }, [code, dark, isComplete])

  // While the block streams, show its source.
  return (
    <RichBlockFrame
      label="Mermaid"
      source={code}
      svg={isComplete ? result?.svg : null}
      error={isComplete ? result?.error : null}
    />
  )
}
