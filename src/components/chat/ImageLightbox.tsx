import { useState, useCallback } from 'react'
import { FolderOpen } from 'lucide-react'
import { convertFileSrc } from '@/lib/transport'
import { canOpenNativeApps } from '@/lib/environment'
import { getFileManagerName } from '@/lib/platform'
import { useRevealPathInFileManager } from '@/services/projects'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'

interface ImagePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** URL the webview can load */
  src: string
  /** Alt text for accessibility */
  alt: string
  /** Local file path; enables "Reveal in {file manager}" */
  path?: string
}

/**
 * Full-size image preview. A local image also gets a Reveal button when this
 * machine can open the native file manager.
 */
export function ImagePreviewDialog({
  open,
  onOpenChange,
  src,
  alt,
  path,
}: ImagePreviewDialogProps) {
  const revealPath = useRevealPathInFileManager()
  const canReveal = Boolean(path) && canOpenNativeApps()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-0 sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!h-auto sm:max-h-[85vh] sm:!rounded-lg sm:p-4 bg-background/95"
        showCloseButton={true}
      >
        <VisuallyHidden>
          <DialogTitle>Image Preview</DialogTitle>
          <DialogDescription>Preview of image: {alt}</DialogDescription>
        </VisuallyHidden>
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-[calc(85vh-6rem)] object-contain rounded-md mx-auto"
        />
        {canReveal && path && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => revealPath.mutate(path)}
            >
              <FolderOpen className="h-4 w-4" />
              Reveal in {getFileManagerName()}
            </Button>
          </div>
        )}
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
