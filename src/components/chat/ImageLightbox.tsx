import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ImgHTMLAttributes,
} from 'react'
import { Copy, ExternalLink, FolderOpen, PanelRight } from 'lucide-react'
import { toast } from 'sonner'
import { convertFileSrc } from '@/lib/transport'
import { copyImageToClipboard } from '@/lib/clipboard'
import {
  canOpenNativeApps,
  isLocalBackend,
  isNativeApp,
} from '@/lib/environment'
import {
  getFileManagerName,
  getModifierSymbol,
  isClientMacOS,
  openExternal,
} from '@/lib/platform'
import { toFileUrl } from '@/lib/path-utils'
import { openUrlInEmbeddedBrowser } from '@/hooks/useBrowserPane'
import { useIsMobile } from '@/hooks/use-mobile'
import { Kbd } from '@/components/ui/kbd'
import { useRevealPathInFileManager } from '@/services/projects'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'
import { HostOnlyHint } from '@/components/ui/host-only-hint'

/** WebKit's non-standard pinch event (no DOM lib type). */
interface WebKitGestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

interface ZoomableImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /**
   * Zoom with Cmd/Ctrl + = / - / 0 while mounted. The keys then zoom the
   * image instead of the app, so only set this in a modal viewer.
   */
  keyboardZoom?: boolean
}

/**
 * An image you can zoom and pan: trackpad or touch pinch, mouse wheel, or
 * double-click to toggle. It fills its parent, so give the parent a size.
 */
export function ZoomableImage({
  className,
  keyboardZoom = false,
  ...imageProps
}: ZoomableImageProps) {
  const transformRef = useRef<ReactZoomPanPinchRef>(null)

  useEffect(() => {
    if (!keyboardZoom) return
    const handleKeyDown = (e: KeyboardEvent) => {
      // Same modifier rule as the app zoom (useZoom).
      const mod = isClientMacOS && isNativeApp() ? e.metaKey : e.ctrlKey
      if (!mod || e.shiftKey || e.altKey) return
      const key = e.key
      if (key !== '=' && key !== '+' && key !== '-' && key !== '0') return
      // Window capture runs before the app zoom's document capture listener,
      // so stopping here keeps the app zoom unchanged.
      e.preventDefault()
      e.stopPropagation()
      const transform = transformRef.current
      if (!transform) return
      if (key === '0') transform.resetTransform()
      else if (key === '-') transform.zoomOut()
      else transform.zoomIn()
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [keyboardZoom])

  // WebKit (the macOS desktop app, Safari) reports a trackpad pinch as
  // gesturestart/gesturechange/gestureend with a running `scale`, not as the
  // ctrl+wheel events react-zoom-pan-pinch reads. Map the gesture to a zoom at
  // the pinch point. Chrome and mouse wheels keep going through the library.
  useEffect(() => {
    const transform = transformRef.current
    const wrapper = transform?.instance.wrapperComponent
    if (!transform || !wrapper) return
    let startScale: number | null = null

    const onGestureStart = (e: Event) => {
      e.preventDefault()
      startScale = transform.instance.state.scale
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      if (startScale === null) return
      const g = e as WebKitGestureEvent
      void transform.zoomToPoint(startScale * g.scale, g.clientX, g.clientY, 0)
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      startScale = null
      // Back at the minimum: re-center like a double-click toggle does.
      if (transform.instance.state.scale <= 1.001) transform.resetTransform()
    }
    // If WebKit also sends ctrl+wheel for the same pinch, let only the gesture
    // events zoom, or the pinch would zoom twice.
    const onWheel = (e: WheelEvent) => {
      if (startScale !== null && e.ctrlKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }

    wrapper.addEventListener('gesturestart', onGestureStart)
    wrapper.addEventListener('gesturechange', onGestureChange)
    wrapper.addEventListener('gestureend', onGestureEnd)
    wrapper.addEventListener('wheel', onWheel, {
      capture: true,
      passive: false,
    })
    return () => {
      wrapper.removeEventListener('gesturestart', onGestureStart)
      wrapper.removeEventListener('gesturechange', onGestureChange)
      wrapper.removeEventListener('gestureend', onGestureEnd)
      wrapper.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [])

  return (
    <TransformWrapper
      ref={transformRef}
      minScale={1}
      maxScale={8}
      centerOnInit
      doubleClick={{ mode: 'toggle' }}
    >
      <TransformComponent
        wrapperClass="!w-full !h-full"
        contentClass="!w-full !h-full items-center justify-center"
      >
        <img
          {...imageProps}
          draggable={false}
          className={cn('select-none', className)}
        />
      </TransformComponent>
    </TransformWrapper>
  )
}

/** Copy the image at `src` to the clipboard and toast the result. */
export function copyImage(src: string): void {
  void copyImageToClipboard(src)
    .then(() => toast.success('Image copied'))
    .catch(err =>
      toast.error(err instanceof Error ? err.message : 'Failed to copy image')
    )
}

// Inline sources a browser tab cannot open as a page.
const INLINE_IMAGE_SRC_RE = /^(data|blob):/i

interface ImagePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** URL the webview can load */
  src: string
  /** Alt text for accessibility */
  alt: string
  /** File path; enables "Reveal in {file manager}" in a local session */
  path?: string
}

/**
 * Full-size image preview with Copy image. In a local session a local image
 * also gets Reveal in {file manager}. In a remote session or web access the
 * file is on the other machine, so it gets Open in browser instead, which opens
 * the URL that machine serves.
 */
export function ImagePreviewDialog({
  open,
  onOpenChange,
  src,
  alt,
  path,
}: ImagePreviewDialogProps) {
  const revealPath = useRevealPathInFileManager()
  const local = isLocalBackend()
  const canReveal = canOpenNativeApps()
  const canOpenInBrowser = !local && !INLINE_IMAGE_SRC_RE.test(src)
  // The browser pane is a native webview that loads the file from disk, so it
  // needs the local desktop backend (as the file browser's Open in browser pane).
  const canOpenInBrowserPane = Boolean(path) && local
  const isMobile = useIsMobile()
  const showKeyboardHints = isNativeApp() && !isMobile
  const mod = getModifierSymbol()

  const handleOpenInBrowserPane = useCallback(async () => {
    if (!path) return
    const opened = await openUrlInEmbeddedBrowser(toFileUrl(path))
    if (opened) onOpenChange(false)
    else
      toast.error('Open a session first to show the image in the browser pane')
  }, [path, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="safe-area-viewer [--viewer-pt:3rem] [--viewer-pb:0.5rem] flex flex-col !w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-0 sm:!h-auto sm:max-h-[85vh] sm:!rounded-lg sm:p-4 bg-background/95"
        showCloseButton={true}
      >
        <VisuallyHidden>
          <DialogTitle>Image Preview</DialogTitle>
          <DialogDescription>Preview of image: {alt}</DialogDescription>
        </VisuallyHidden>
        {/* The app viewport disables browser zoom, so pinch/wheel/double-tap
            zoom comes from react-zoom-pan-pinch. */}
        <div className="flex-1 min-h-0 touch-none sm:flex-none">
          <ZoomableImage
            keyboardZoom
            src={src}
            alt={alt}
            className="max-w-full max-h-full sm:max-h-[calc(85vh-6rem)] object-contain rounded-md"
          />
        </div>
        <div className="flex shrink-0 justify-center gap-1">
          {path && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!canReveal}
              onClick={() => revealPath.mutate(path)}
            >
              <FolderOpen className="h-4 w-4" />
              Reveal in {getFileManagerName()}
              {!canReveal && <HostOnlyHint />}
            </Button>
          )}
          {canOpenInBrowserPane && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleOpenInBrowserPane()}
            >
              <PanelRight className="h-4 w-4" />
              Open in browser pane
            </Button>
          )}
          {canOpenInBrowser && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void openExternal(src).catch(() =>
                  toast.error('Failed to open the image in the browser')
                )
              }
            >
              <ExternalLink className="h-4 w-4" />
              Open in browser
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => copyImage(src)}>
            <Copy className="h-4 w-4" />
            Copy image
          </Button>
          {showKeyboardHints && (
            <span
              className="ml-2 hidden items-center gap-1 text-xs text-muted-foreground sm:flex"
              data-testid="image-zoom-hints"
            >
              <Kbd>{mod}+</Kbd>
              <Kbd>{mod}−</Kbd>
              <span>zoom</span>
              <Kbd>{mod}0</Kbd>
              <span>fit</span>
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ImageLightboxProps {
  /** File path to the image */
  src: string
  /** Alt text for accessibility */
  alt: string
  /** Thumbnail className */
  thumbnailClassName?: string
  /** Optional wrapper className */
  className?: string
  /** Children to render as the clickable thumbnail (if not using default img) */
  children?: React.ReactNode
}

/**
 * Displays an image thumbnail that opens in a full-size lightbox modal when clicked
 */
export function ImageLightbox({
  src,
  alt,
  thumbnailClassName,
  className,
  children,
}: ImageLightboxProps) {
  const [isOpen, setIsOpen] = useState(false)

  const handleOpen = useCallback(() => {
    setIsOpen(true)
  }, [])

  const assetSrc = convertFileSrc(src)

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        data-local-path={src}
        className={`cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-md ${className ?? ''}`}
      >
        {children ?? (
          <img src={assetSrc} alt={alt} className={thumbnailClassName} />
        )}
      </button>

      <ImagePreviewDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        src={assetSrc}
        alt={alt}
        path={src}
      />
    </>
  )
}
