import { getActiveRemoteConnection } from '@/lib/remote-connections'
import { invoke } from '@/lib/transport'

/**
 * URL of a backend file as a static preview the remote backend serves (see
 * `jean-core/src/http_server/preview.rs`). A connection window cannot load
 * `file://` for it: the path names a file on the other machine. `suffix` is
 * a `?query` / `#fragment` to keep.
 */
export async function getRemotePreviewUrl(
  path: string,
  suffix = ''
): Promise<string> {
  const remote = getActiveRemoteConnection()
  if (!remote) throw new Error('No remote connection')
  const { url } = await invoke<{ url: string }>('get_preview_url', { path })
  return `${remote.url.replace(/\/+$/, '')}${url}${suffix}`
}
