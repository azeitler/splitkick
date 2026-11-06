import { toast } from 'sonner'
import { openFileInBrowser } from '@/components/artifact-preview/open-in-browser'
import {
  classifyChatLink,
  openChatLink,
  resolveLocalPath,
} from '@/lib/chat-links'
import { openExternal } from '@/lib/platform'
import { useUIStore } from '@/store/ui-store'
import type { Artifact } from '@/types/chat'

/** Whether an artifact is a web URL (else a local file). */
export function isWebArtifact(target: string): boolean {
  return classifyChatLink(target) === 'web'
}

/**
 * Open an artifact. A URL opens in the in-app browser (the system browser
 * where there is none); a file opens in the file viewer, which shows HTML
 * and SVG in the sandboxed preview (#76) and images as images.
 *
 * `system: true` opens it outside Splitkick: the system browser for a URL,
 * the default app (or the backend's preview URL when remote) for a file.
 * Call it from the click handler, so Web Access keeps the popup permission.
 */
export function openArtifact(
  artifact: Pick<Artifact, 'target' | 'title'>,
  rootPath: string | null,
  { system = false }: { system?: boolean } = {}
): void {
  const { target, title } = artifact
  if (isWebArtifact(target)) {
    if (system) {
      void openExternal(target).catch(error => {
        toast.error(`Could not open ${title}: ${error}`)
      })
    } else {
      openChatLink(target)
    }
    return
  }

  const path = resolveLocalPath(target, rootPath)
  if (!path) {
    toast.error(`Could not open ${title}: ${target} is not a file path`)
    return
  }
  if (system) {
    void openFileInBrowser(path).catch(error => {
      toast.error(`Could not open ${title}: ${error}`)
    })
    return
  }
  // No label: the viewer picks the preview (HTML, SVG, image) from the
  // name it shows, so it must be the file name, not the artifact title.
  useUIStore.getState().setViewingFilePath(path)
}
