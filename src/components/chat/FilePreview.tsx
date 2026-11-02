import { useCallback } from 'react'
import { FileIcon, FolderIcon } from 'lucide-react'
import { DismissButton } from '@/components/ui/dismiss-button'
import type { PendingFile } from '@/types/chat'
import { cn } from '@/lib/utils'
import { getExtensionColor } from '@/lib/file-colors'
import { getFilename } from '@/lib/path-utils'
import { useUIStore } from '@/store/ui-store'
import { getArtifactKind } from '@/components/artifact-preview/sandbox'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

interface FilePreviewProps {
  /** Array of pending files to display */
  files: PendingFile[]
  /** Callback when user removes a file */
  onRemove: (fileId: string) => void
  /** Whether removal is disabled (e.g., while sending) */
  disabled?: boolean
  /** Worktree root for files without their own `sourceRootPath` */
  rootPath?: string | null
}

/** Absolute path of a previewable (HTML/SVG) file, else null. */
function getPreviewPath(
  file: PendingFile,
  rootPath: string | null | undefined
): string | null {
  if (file.isDirectory || !getArtifactKind(file.relativePath)) return null
  const root = file.sourceRootPath ?? rootPath
  if (!root) return null
  return `${root.replace(/\/+$/, '')}/${file.relativePath.replace(/^\/+/, '')}`
}

/**
 * Displays pills for pending file attachments before sending
 * Renders above the chat input area
 */
export function FilePreview({
  files,
  onRemove,
  disabled,
  rootPath,
}: FilePreviewProps) {
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
      {files.map(file => {
        const previewPath = getPreviewPath(file, rootPath)
        const name = file.isDirectory
          ? `${getFilename(file.relativePath)}/`
          : getFilename(file.relativePath)
        return (
          <Tooltip key={file.id}>
            <TooltipTrigger asChild>
              <div className="group relative flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-sm">
                {file.isDirectory ? (
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                ) : (
                  <FileIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      getExtensionColor(file.extension)
                    )}
                  />
                )}
                {previewPath ? (
                  // HTML/SVG opens in the file viewer's sandboxed preview.
                  <button
                    type="button"
                    aria-label={`Preview ${name}`}
                    onClick={() =>
                      useUIStore
                        .getState()
                        .setViewingFilePath(previewPath, file.relativePath)
                    }
                    className="max-w-32 truncate cursor-pointer hover:underline"
                  >
                    {name}
                  </button>
                ) : (
                  <span className="max-w-32 truncate">{name}</span>
                )}
                {!disabled && (
                  <DismissButton
                    tooltip={
                      file.isDirectory ? 'Remove directory' : 'Remove file'
                    }
                    onClick={e => handleRemove(e, file)}
                    className="ml-1"
                  />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {file.sourceProjectName
                ? `${file.sourceProjectName}: ${file.relativePath}`
                : file.relativePath}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
