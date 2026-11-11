import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { ArtifactPreview } from '@/components/artifact-preview/ArtifactPreview'
import { detectMarkupKind } from '@/components/artifact-preview/sandbox'
import { getChatComposerBottomOffset } from '@/lib/chat-composer-metrics'

/**
 * Preview of an ```html / ```svg chat block. It opens only on the user's
 * "Preview" click (registry mode `preview`), in the artifact sandbox.
 */
export default function HtmlPreviewBlock({
  code,
}: {
  code: string
  isComplete: boolean
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const kind = detectMarkupKind(code)

  // The block mounts only after the user clicked Preview, so bring it into
  // view once: below the last message it opened hidden under the input bar
  // (#81). The bottom scroll margin keeps it above the composer.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.style.scrollMarginBottom = `${getChatComposerBottomOffset() + 16}px`
    root.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])
  const title = kind === 'svg' ? 'SVG preview' : 'HTML preview'

  return (
    <div
      ref={rootRef}
      data-testid="html-preview-block"
      className="overflow-hidden rounded-lg border border-border"
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
        <span>{title} · sandboxed, no network</span>
        <button
          type="button"
          onClick={() => setReloadKey(k => k + 1)}
          aria-label="Reload preview"
          className="rounded p-1 hover:bg-background/80 hover:text-foreground cursor-pointer"
        >
          <RotateCw className="size-3.5" />
        </button>
      </div>
      <ArtifactPreview
        key={reloadKey}
        kind={kind}
        content={code}
        title={title}
        className="h-[420px] resize-y overflow-auto rounded-none"
      />
    </div>
  )
}
