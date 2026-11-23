import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { ArtifactPreview } from '@/components/artifact-preview/ArtifactPreview'
import { detectMarkupKind } from '@/components/artifact-preview/sandbox'

/** Height before the page reports its own, and for SVG. */
export const PREVIEW_DEFAULT_HEIGHT = 420
export const PREVIEW_MIN_HEIGHT = 120
/** Share of the window height a preview may take before it scrolls. */
export const PREVIEW_MAX_SHARE = 0.7

/** The height a preview gets for the height its content reports. */
export function clampPreviewHeight(
  contentHeight: number,
  windowHeight: number
): number {
  const max = Math.max(
    PREVIEW_MIN_HEIGHT,
    Math.round(windowHeight * PREVIEW_MAX_SHARE)
  )
  return Math.min(max, Math.max(PREVIEW_MIN_HEIGHT, Math.ceil(contentHeight)))
}

/**
 * Preview of an ```html / ```svg chat block, in the artifact sandbox
 * (scripts only, opaque origin, no network). It shows as soon as the block
 * is complete; `actions` (the source toggle) sit in its header bar.
 *
 * An HTML page reports the height its content needs, and the preview takes
 * it, between PREVIEW_MIN_HEIGHT and PREVIEW_MAX_SHARE of the window. Once
 * the user drags the resize handle, their height wins.
 *
 * It does not scroll itself into view: it now mounts for every complete
 * block, also in an older chat, and would pull the view to each one.
 */
export default function HtmlPreviewBlock({
  code,
  actions,
}: {
  code: string
  isComplete: boolean
  actions?: ReactNode
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const kind = detectMarkupKind(code)
  const title = kind === 'svg' ? 'SVG preview' : 'HTML preview'

  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentHeightRef = useRef<number | null>(null)
  const appliedRef = useRef(PREVIEW_DEFAULT_HEIGHT)
  const manualRef = useRef(false)

  // Set imperatively, not through React's style prop: a re-render would
  // otherwise undo the height the user dragged to.
  const applyHeight = useCallback(() => {
    const frame = wrapperRef.current?.querySelector('iframe')
    const contentHeight = contentHeightRef.current
    if (!frame || manualRef.current || contentHeight === null) return
    const height = clampPreviewHeight(contentHeight, window.innerHeight)
    if (height === appliedRef.current) return
    appliedRef.current = height
    frame.style.height = `${height}px`
  }, [])

  const handleContentHeight = useCallback(
    (height: number) => {
      contentHeightRef.current = height
      applyHeight()
    },
    [applyHeight]
  )

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || kind !== 'html') return
    // A height we did not set came from the resize handle.
    const observer = new ResizeObserver(() => {
      const height = wrapper.getBoundingClientRect().height
      // No frame yet (native app loading its frame URL): nothing to compare.
      if (!wrapper.querySelector('iframe') || height === 0) return
      if (Math.abs(height - appliedRef.current) > 2) manualRef.current = true
    })
    observer.observe(wrapper)
    window.addEventListener('resize', applyHeight)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', applyHeight)
    }
  }, [kind, applyHeight])

  return (
    <div
      data-testid="html-preview-block"
      className="overflow-hidden rounded-lg border border-border"
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
        <span>{title} · sandboxed, no network</span>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => {
              // A reload starts at the measured height again.
              manualRef.current = false
              appliedRef.current = PREVIEW_DEFAULT_HEIGHT
              setReloadKey(k => k + 1)
            }}
            aria-label="Reload preview"
            className="rounded p-1 hover:bg-background/80 hover:text-foreground cursor-pointer"
          >
            <RotateCw className="size-3.5" />
          </button>
        </div>
      </div>
      <div ref={wrapperRef}>
        <ArtifactPreview
          key={reloadKey}
          kind={kind}
          content={code}
          title={title}
          className="h-[420px] resize-y overflow-auto rounded-none"
          onContentHeight={kind === 'html' ? handleContentHeight : undefined}
        />
      </div>
    </div>
  )
}
