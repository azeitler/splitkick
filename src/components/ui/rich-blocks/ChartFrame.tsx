import { useState, type ReactNode } from 'react'
import { Code2, Copy, Expand, FileImage, Image, BarChart3 } from 'lucide-react'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface ChartFrameAction {
  label: string
  icon: ReactNode
  onClick: () => void
}

interface ChartFrameProps {
  /** Label shown at the top left, e.g. "Vega-Lite". */
  label: string
  source: string
  /** Error message; when set, the frame shows the source and the error. */
  error?: string | null
  onCopySource: () => void
  onCopySvg?: () => void
  onCopyPng?: () => void
  /** Renders the visual; called again inside the full screen dialog. */
  renderVisual: (fullscreen: boolean) => ReactNode
}

function ToolbarButton({
  label,
  icon,
  onClick,
  pressed,
}: ChartFrameAction & { pressed?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground cursor-pointer',
            pressed && 'bg-background/80 text-foreground'
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Source({ code }: { code: string }) {
  return (
    <pre className="max-w-full overflow-x-auto p-4 text-sm">
      <code>{code}</code>
    </pre>
  )
}

/** Shared chrome for a rendered code block: toolbar, source view, full screen. */
export function ChartFrame({
  label,
  source,
  error,
  onCopySource,
  onCopySvg,
  onCopyPng,
  renderVisual,
}: ChartFrameProps) {
  const [showSource, setShowSource] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const iconClass = 'size-4'

  return (
    <div
      className="my-5 min-w-0 max-w-full overflow-hidden rounded-lg bg-muted"
      data-testid="chart-frame"
    >
      <div className="flex items-center gap-1 border-b border-border/60 px-3 py-1">
        <span className="mr-auto text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {!error && (
          <>
            <ToolbarButton
              label={showSource ? 'Show chart' : 'Show source'}
              icon={
                showSource ? (
                  <BarChart3 className={iconClass} />
                ) : (
                  <Code2 className={iconClass} />
                )
              }
              onClick={() => setShowSource(value => !value)}
              pressed={showSource}
            />
            <ToolbarButton
              label="Full screen"
              icon={<Expand className={iconClass} />}
              onClick={() => setFullscreen(true)}
            />
          </>
        )}
        <ToolbarButton
          label="Copy source"
          icon={<Copy className={iconClass} />}
          onClick={onCopySource}
        />
        {!error && onCopySvg && (
          <ToolbarButton
            label="Copy as SVG"
            icon={<FileImage className={iconClass} />}
            onClick={onCopySvg}
          />
        )}
        {!error && onCopyPng && (
          <ToolbarButton
            label="Copy as PNG"
            icon={<Image className={iconClass} />}
            onClick={onCopyPng}
          />
        )}
      </div>

      {error ? (
        <>
          <div
            role="alert"
            className="border-b border-border/60 px-4 py-2 text-sm text-destructive"
          >
            {error}
          </div>
          <Source code={source} />
        </>
      ) : (
        <>
          {showSource && <Source code={source} />}
          {/* Stays mounted under the source view, so copy as SVG/PNG works. */}
          <div className={cn('p-4', showSource && 'hidden')}>
            {renderVisual(false)}
          </div>
        </>
      )}

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex flex-col !w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-4 pt-[calc(var(--safe-area-top)+3rem)] sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!h-auto sm:max-h-[85vh] sm:!rounded-lg">
          <VisuallyHidden>
            <DialogTitle>{label} full screen</DialogTitle>
            <DialogDescription>Full screen view of the chart</DialogDescription>
          </VisuallyHidden>
          <div className="min-h-0 flex-1 overflow-auto sm:h-[75vh] sm:flex-none">
            {fullscreen && renderVisual(true)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
