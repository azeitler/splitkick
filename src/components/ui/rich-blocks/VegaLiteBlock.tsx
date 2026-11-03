import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { View } from 'vega'
import type { TopLevelSpec } from 'vega-lite'
import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/clipboard'
import { ChartFrame } from './ChartFrame'
import { useDocumentTheme } from './use-document-theme'
import {
  exportPng,
  exportSvg,
  parseVegaLiteSpec,
  renderVegaLite,
  type ChartTheme,
} from './vega-chart'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

interface ChartViewProps {
  spec: TopLevelSpec
  theme: ChartTheme
  /** Fill the container height too (full screen). */
  fill?: boolean
  onView?: (view: View | null) => void
  onError: (message: string) => void
}

function ChartView({
  spec,
  theme,
  fill = false,
  onView,
  onError,
}: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let view: View | null = null
    let cancelled = false
    renderVegaLite(container, spec, theme, fill).then(
      rendered => {
        if (cancelled) {
          rendered.finalize()
          return
        }
        view = rendered
        onView?.(rendered)
      },
      error => {
        if (!cancelled) onError(errorMessage(error))
      }
    )
    return () => {
      cancelled = true
      view?.finalize()
      onView?.(null)
      container.replaceChildren()
    }
  }, [spec, theme, fill, onView, onError])

  return (
    <div
      ref={containerRef}
      data-testid="vega-lite-chart"
      data-theme={theme}
      className={fill ? 'h-full w-full' : 'w-full overflow-x-auto'}
    />
  )
}

/** Renders a ```vega-lite block (JSON spec, inline data only) as a chart. */
export default function VegaLiteBlock({
  code,
  isComplete,
}: {
  code: string
  isComplete: boolean
}) {
  const theme = useDocumentTheme()
  const viewRef = useRef<View | null>(null)
  const [renderError, setRenderError] = useState<{
    code: string
    message: string
  } | null>(null)

  const parsed = useMemo(() => {
    if (!isComplete) return null
    try {
      return { spec: parseVegaLiteSpec(code), error: null }
    } catch (error) {
      return { spec: null, error: errorMessage(error) }
    }
  }, [code, isComplete])

  const handleView = useCallback((view: View | null) => {
    viewRef.current = view
  }, [])
  const handleError = useCallback(
    (message: string) => setRenderError({ code, message }),
    [code]
  )

  const handleCopySource = useCallback(() => {
    copyToClipboard(code).then(
      () => toast.success('Copied to clipboard'),
      error => toast.error(errorMessage(error))
    )
  }, [code])

  const handleCopySvg = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    exportSvg(view, theme)
      .then(copyToClipboard)
      .then(
        () => toast.success('Copied chart as SVG'),
        error => toast.error(errorMessage(error))
      )
  }, [theme])

  const handleCopyPng = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      toast.error('Copy failed: this browser cannot copy images.')
      return
    }
    // Pass the blob as a promise: WebKit drops the user gesture otherwise.
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': exportPng(view, theme) })])
      .then(
        () => toast.success('Copied chart as PNG'),
        error => toast.error(`Copy failed: ${errorMessage(error)}`)
      )
  }, [theme])

  // While the message streams, the spec is not valid JSON yet.
  if (!parsed) {
    return (
      <pre className="my-5 max-w-full overflow-x-auto rounded-lg bg-muted p-4 text-sm">
        <code>{code}</code>
      </pre>
    )
  }

  const error =
    parsed.error ?? (renderError?.code === code ? renderError.message : null)
  const spec = parsed.spec

  return (
    <ChartFrame
      label="Vega-Lite"
      source={code}
      error={error}
      onCopySource={handleCopySource}
      onCopySvg={handleCopySvg}
      onCopyPng={handleCopyPng}
      renderVisual={fullscreen =>
        spec && (
          <ChartView
            spec={spec}
            theme={theme}
            fill={fullscreen}
            onView={fullscreen ? undefined : handleView}
            onError={handleError}
          />
        )
      }
    />
  )
}
