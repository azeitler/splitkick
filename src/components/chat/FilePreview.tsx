import { useCallback } from 'react'
import { FileIcon, X } from 'lucide-react'
import type { PendingFile } from '@/types/chat'
import { cn } from '@/lib/utils'
import { getExtensionColor } from '@/lib/file-colors'
import { getFilename } from '@/lib/path-utils'

interface FilePreviewProps {
  /** Array of pending files to display */
  files: PendingFile[]
  /** Callback when user removes a file */
  onRemove: (fileId: string) => void
  /** Whether removal is disabled (e.g., while sending) */
  disabled?: boolean
}

/**
 * Displays pills for pending file attachments before sending
 * Renders above the chat input area
 */
export function FilePreview({ files, onRemove, disabled }: FilePreviewProps) {
  const handleRemove = useCallback(
    (e: React.MouseEvent, file: PendingFile) => {
      e.stopPropagation()
      if (disabled) return
      onRemove(file.id)
    },
    [disabled, onRemove]
  )

  if (files.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2 md:px-6">
      {files.map(file => (
        <div
          key={file.id}
          className="group relative flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-sm"
          title={file.relativePath}
        >
          <FileIcon
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              getExtensionColor(file.extension)
            )}
          />
          <span className="max-w-32 truncate">
            {getFilename(file.relativePath)}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={e => handleRemove(e, file)}
              className="ml-1 p-0.5 rounded-full hover:bg-destructive/20 transition-colors"
              title="Remove file"
            >
              <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
