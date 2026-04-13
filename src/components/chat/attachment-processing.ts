import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { useChatStore } from '@/store/chat-store'
import type { SaveImageResponse, SaveTextResponse } from '@/types/chat'
import {
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_TYPES,
  getImageMimeTypeFromFilename,
  MAX_IMAGE_SIZE,
  MAX_TEXT_SIZE,
  SVG_EXTENSION,
  SVG_MIME_TYPE,
} from './image-constants'

function createPlaceholderId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

export type AttachmentFileKind = 'raster' | 'svg' | 'unsupported'

export function classifyAttachmentFile(
  file: Pick<File, 'name' | 'type'>
): AttachmentFileKind {
  const mimeType = file.type.toLowerCase()
  const extension = getExtension(file.name)

  if (mimeType === SVG_MIME_TYPE || extension === SVG_EXTENSION) return 'svg'
  if (
    ALLOWED_IMAGE_TYPES.includes(
      mimeType as (typeof ALLOWED_IMAGE_TYPES)[number]
    ) ||
    ALLOWED_IMAGE_EXTENSIONS.includes(extension)
  ) {
    return 'raster'
  }

  return 'unsupported'
}

export async function processAttachmentFile(
  file: File,
  sessionId: string
): Promise<void> {
  const kind = classifyAttachmentFile(file)

  if (kind === 'unsupported') {
    toast.error('Unsupported image type', {
      description: 'Allowed types: PNG, JPEG, GIF, WebP, SVG',
    })
    return
  }

  if (kind === 'svg') {
    if (file.size > MAX_TEXT_SIZE) {
      toast.error('SVG too large', {
        description: 'Maximum size is 10MB',
      })
      return
    }

    try {
      const svgText = await file.text()
      const result = await invoke<SaveTextResponse>('save_pasted_text', {
        content: svgText,
      })

      useChatStore.getState().addPendingTextFile(sessionId, {
        id: result.id,
        path: result.path,
        filename: file.name || result.filename,
        size: result.size,
        content: svgText,
      })
    } catch (error) {
      console.error('Failed to save SVG:', error)
      toast.error('Failed to save SVG', {
        description: String(error),
      })
    }

    return
  }

  if (file.size > MAX_IMAGE_SIZE) {
    toast.error('Image too large', {
      description: 'Maximum size is 10MB',
    })
    return
  }

  const mimeType = file.type || getImageMimeTypeFromFilename(file.name)
  if (!mimeType) {
    toast.error('Unsupported image type', {
      description: 'Allowed types: PNG, JPEG, GIF, WebP, SVG',
    })
    return
  }

  const placeholderId = createPlaceholderId('loading')
  const { addPendingImage, updatePendingImage, removePendingImage } =
    useChatStore.getState()

  addPendingImage(sessionId, {
    id: placeholderId,
    path: '',
    filename: 'Processing...',
    loading: true,
  })

  try {
    const dataBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(dataBuffer)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    const base64Data = btoa(binary)

    const result = await invoke<SaveImageResponse>('save_pasted_image', {
      data: base64Data,
      mimeType,
    })

    updatePendingImage(sessionId, placeholderId, {
      id: result.id,
      path: result.path,
      filename: result.filename,
      loading: false,
    })
  } catch (error) {
    console.error('Failed to save image:', error)
    removePendingImage(sessionId, placeholderId)
    toast.error('Failed to save image', {
      description: String(error),
    })
  }
}

export async function processAttachmentFiles(
  files: Iterable<File>,
  sessionId: string
): Promise<void> {
  for (const file of files) {
    await processAttachmentFile(file, sessionId)
  }
}
