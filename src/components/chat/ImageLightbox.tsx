import { useState, useCallback, type ImgHTMLAttributes } from 'react'
import { Copy, ExternalLink, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { convertFileSrc } from '@/lib/transport'
import { copyImageToClipboard } from '@/lib/clipboard'
import { isLocalBackend } from '@/lib/environment'
import { getFileManagerName, openExternal } from '@/lib/platform'
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
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

/**
 * An image you can zoom and pan: pinch, wheel, or double-click to toggle. It
 * fills its parent, so give the parent a size.
 */
export function ZoomableImage({
  className,
  ...imageProps
}: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <TransformWrapper
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
  const canReveal = Boolean(path) && local
  const canOpenInBrowser = !local && !INLINE_IMAGE_SRC_RE.test(src)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col !w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-0 pt-[calc(var(--safe-area-top)+3rem)] pb-[calc(var(--safe-area-bottom)+0.5rem)] [&>[data-slot=dialog-close]]:top-[calc(var(--safe-area-top)+1rem)] sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!h-auto sm:max-h-[85vh] sm:!rounded-lg sm:p-4 sm:[&>[data-slot=dialog-close]]:top-4 bg-background/95"
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
            src={src}
            alt={alt}
            className="max-w-full max-h-full sm:max-h-[calc(85vh-6rem)] object-contain rounded-md"
          />
        </div>
        <div className="flex shrink-0 justify-center gap-1">
          {canReveal && path && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => revealPath.mutate(path)}
            >
              <FolderOpen className="h-4 w-4" />
              Reveal in {getFileManagerName()}
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
