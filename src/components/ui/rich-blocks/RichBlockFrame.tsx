import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  Code,
  Copy,
  Image as ImageIcon,
  Maximize2,
  Shapes,
  FileCode,
} from 'lucide-react'
import { toast } from 'sonner'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { copyPngToClipboard, copyToClipboard } from '@/lib/clipboard'
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

/** True while the app shows the dark theme (the `dark` class on <html>). */
export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  )
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() =>
      setDark(root.classList.contains('dark'))
    )
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/** Draw SVG markup on a canvas at 2× and return it as PNG. */
export async function svgToPngBlob(
  svg: string,
  background: string
): Promise<Blob> {
  // Parse as HTML (lenient), then serialize as XML: an <img> needs valid XML.
  const el = new DOMParser()
    .parseFromString(svg, 'text/html')
    .querySelector('svg')
  if (!el) throw new Error('Copy failed: no SVG to copy.')
  const viewBox = el
    .getAttribute('viewBox')
    ?.split(/[\s,]+/)
    .map(Number)
  const width =
    viewBox?.[2] || parseFloat(el.getAttribute('width') ?? '') || 800
  const height =
    viewBox?.[3] || parseFloat(el.getAttribute('height') ?? '') || 600
  el.setAttribute('width', String(width))
  el.setAttribute('height', String(height))
  el.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    new XMLSerializer().serializeToString(el)
  )}`
  await img.decode()

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Copy failed: no canvas.')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(png => {
      if (png) resolve(png)
      else reject(new Error('Copy failed: could not convert the SVG to PNG.'))
    }, 'image/png')
  })
}

function copyText(text: string, message: string) {
  copyToClipboard(text)
    .then(() => toast.success(message))
    .catch(err =>
      toast.error(err instanceof Error ? err.message : 'Failed to copy')
    )
}

const BTN_CLASS =
  'p-1.5 rounded-md text-muted-foreground opacity-70 hover:opacity-100 hover:bg-background/80 hover:text-foreground transition-opacity cursor-pointer'

function ToolbarButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  pressed?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={pressed}
          className={BTN_CLASS}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface RichBlockFrameProps {
  /** Kind of block, e.g. "Mermaid" — used in labels and the error title. */
  label: string
  /** The code block source. */
  source: string
  /** Rendered SVG markup. Enables the diagram view, full screen and copies. */
  svg?: string | null
  /** Render error. Shows the message above the source. */
  error?: string | null
}

/**
 * Shared chrome for rich code blocks: the rendered view with a toolbar
 * (source toggle, full screen, copy source / SVG / PNG), the source while
 * there is nothing rendered yet, and the error view.
 */
export function RichBlockFrame({
  label,
  source,
  svg,
  error,
}: RichBlockFrameProps) {
  const [showSource, setShowSource] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const dark = useIsDarkTheme()

  const handleCopySource = useCallback(() => {
    copyText(source, 'Copied to clipboard')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [source])

  const handleCopyPng = useCallback(() => {
    if (!svg) return
    copyPngToClipboard(svgToPngBlob(svg, dark ? '#1e1e1e' : '#ffffff'))
      .then(() => toast.success('Copied as PNG'))
      .catch(err =>
        toast.error(err instanceof Error ? err.message : 'Failed to copy PNG')
      )
  }, [svg, dark])

  const sourceView = (
    <pre className="max-w-full overflow-x-auto p-4 text-sm">
      <code>{source}</code>
    </pre>
  )
  const showDiagram = Boolean(svg) && !error && !showSource

  return (
    <div
      className="relative my-5 min-w-0 max-w-full rounded-lg bg-muted"
      data-rich-block={label.toLowerCase()}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-0.5 rounded-md bg-muted/80">
        {svg && !error && (
          <>
            <ToolbarButton
              label={showSource ? `Show ${label} diagram` : 'Show source'}
              onClick={() => setShowSource(v => !v)}
              pressed={showSource}
            >
              {showSource ? (
                <Shapes className="size-4" />
              ) : (
                <Code className="size-4" />
              )}
            </ToolbarButton>
            <ToolbarButton
              label="Open full screen"
              onClick={() => setFullScreen(true)}
            >
              <Maximize2 className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Copy as SVG"
              onClick={() => copyText(svg, 'Copied as SVG')}
            >
              <FileCode className="size-4" />
            </ToolbarButton>
            <ToolbarButton label="Copy as PNG" onClick={handleCopyPng}>
              <ImageIcon className="size-4" />
            </ToolbarButton>
          </>
        )}
        <ToolbarButton label="Copy source" onClick={handleCopySource}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </ToolbarButton>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-border px-4 py-3 pr-12 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">
              Could not render the {label} diagram
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
              {error}
            </pre>
          </div>
        </div>
      )}

      {showDiagram && svg ? (
        <div
          className="flex justify-center overflow-x-auto p-4 pt-10 [&_svg]:h-auto [&_svg]:max-h-[min(60vh,560px)] [&_svg]:max-w-full"
          role="img"
          aria-label={`${label} diagram`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className={cn(!error && (svg ? 'pt-8' : 'pr-10'))}>
          {sourceView}
        </div>
      )}

      {svg && fullScreen && (
        <Dialog open={fullScreen} onOpenChange={setFullScreen}>
          <DialogContent
            className="flex flex-col !w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-0 pt-[calc(var(--safe-area-top)+3rem)] pb-[calc(var(--safe-area-bottom)+0.5rem)] [&>[data-slot=dialog-close]]:top-[calc(var(--safe-area-top)+1rem)] sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!h-[85vh] sm:!rounded-lg sm:p-4 sm:pt-12 sm:[&>[data-slot=dialog-close]]:top-4 bg-background"
            showCloseButton
          >
            <VisuallyHidden>
              <DialogTitle>{label} diagram</DialogTitle>
              <DialogDescription>
                Zoom with pinch, the mouse wheel or a double-click; drag to pan.
              </DialogDescription>
            </VisuallyHidden>
            <div className="flex-1 min-h-0 touch-none">
              <TransformWrapper
                minScale={0.5}
                maxScale={8}
                centerOnInit
                doubleClick={{ mode: 'toggle' }}
              >
                <TransformComponent
                  wrapperClass="!w-full !h-full"
                  contentClass="!w-full !h-full"
                >
                  <div
                    className="h-full w-full [&_svg]:!h-full [&_svg]:!w-full [&_svg]:!max-w-none"
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                </TransformComponent>
              </TransformWrapper>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
