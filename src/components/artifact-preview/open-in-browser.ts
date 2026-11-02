import { invoke } from '@/lib/transport'
import { isLocalBackend, isNativeApp } from '@/lib/environment'
import { openExternal, preOpenWindow } from '@/lib/platform'
import { getRemotePreviewUrl } from '@/lib/remote-preview'

/**
 * Open a worktree file in the system browser.
 *
 * - Local desktop: the OS opens the file with its default app.
 * - Remote backend or Web Access: the file is on the backend machine, so it
 *   opens as the preview URL the backend serves. That response carries
 *   `Content-Security-Policy: sandbox`, so the page gets an opaque origin and
 *   cannot read the web UI's token (see `jean-core/src/http_server/server.rs`).
 *
 * Call it from the click handler: web access opens the tab before the first
 * await, or the popup blocker stops it.
 */
export async function openFileInBrowser(path: string): Promise<void> {
  if (isLocalBackend()) {
    await invoke('open_path_in_default_app', { path })
    return
  }

  const preOpened = preOpenWindow()
  if (preOpened) preOpened.opener = null
  try {
    const url = isNativeApp()
      ? await getRemotePreviewUrl(path)
      : `${window.location.origin}${(await invoke<{ url: string }>('get_preview_url', { path })).url}`
    await openExternal(url, preOpened)
  } catch (error) {
    preOpened?.close()
    throw error
  }
}
