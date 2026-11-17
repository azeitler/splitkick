import { useState, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { ArtifactPreview } from '@/components/artifact-preview/ArtifactPreview'
import { detectMarkupKind } from '@/components/artifact-preview/sandbox'

/**
 * Preview of an ```html / ```svg chat block, in the artifact sandbox
 * (scripts only, opaque origin, no network). It shows as soon as the block
 * is complete; `actions` (the source toggle) sit in its header bar.
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
            onClick={() => setReloadKey(k => k + 1)}
            aria-label="Reload preview"
            className="rounded p-1 hover:bg-background/80 hover:text-foreground cursor-pointer"
          >
            <RotateCw className="size-3.5" />
          </button>
        </div>
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
