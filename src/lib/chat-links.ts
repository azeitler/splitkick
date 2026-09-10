import { toast } from 'sonner'
import { isLocalBackend, isNativeApp } from '@/lib/environment'
import { isHtmlFile, toFileUrl } from '@/lib/path-utils'
import { openExternal } from '@/lib/platform'
import { invoke } from '@/lib/transport'
import { openUrlInEmbeddedBrowser } from '@/hooks/useBrowserPane'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'

// Markdown percent-encodes a backslash before URL checks see it, so a
// drive path can arrive as `C:%5Csite%5Cpage.html`.
const WINDOWS_DRIVE_RE = /^[a-z]:(?:[\\/]|%5c)/i
const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i

/**
 * What a link in a chat response points to.
 * - `web`: an http(s) URL.
 * - `page`: a local HTML file, which the embedded browser renders.
 * - `file`: any other local file, which the file viewer shows.
 */
export type ChatLinkKind = 'web' | 'page' | 'file'

/** Split `report.html#top` into the path and its `?query` / `#fragment`. */
function splitSuffix(ref: string): [string, string] {
  const index = ref.search(/[?#]/)
  return index === -1 ? [ref, ''] : [ref.slice(0, index), ref.slice(index)]
}

/**
 * Resolve a markdown link/image reference to a local filesystem path.
 * Absolute paths (POSIX, Windows drive, file://) are returned decoded;
 * relative paths resolve against the active worktree. Returns null for
 * anchors, other URL schemes, or relative paths without a worktree.
 */
export function resolveLocalPath(ref: string | undefined): string | null {
  if (!ref || ref.startsWith('#')) return null

  let path = ref
  if (/^file:/i.test(path)) {
    path = path.replace(/^file:(\/\/)?/i, '').replace(/^\/(?=[a-z]:)/i, '')
  } else if (URL_SCHEME_RE.test(path) && !WINDOWS_DRIVE_RE.test(path)) {
    return null
  }

  try {
    path = decodeURIComponent(path)
  } catch {
    // Malformed percent-encoding: keep the raw reference.
  }

  if (path.startsWith('/') || WINDOWS_DRIVE_RE.test(path)) return path

  const rootPath = useChatStore.getState().activeWorktreePath
  if (!rootPath) return null
  const separator = rootPath.includes('\\') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]+$/, '')}${separator}${path.replace(/^[\\/]+/, '')}`
}

/** Classify a link href without touching any store (safe during render). */
export function classifyChatLink(
  href: string | undefined
): ChatLinkKind | null {
  if (!href || href.startsWith('#')) return null
  if (/^https?:/i.test(href)) return 'web'
  if (
    URL_SCHEME_RE.test(href) &&
    !/^file:/i.test(href) &&
    !WINDOWS_DRIVE_RE.test(href)
  ) {
    return null
  }
  return isHtmlFile(splitSuffix(href)[0]) ? 'page' : 'file'
}

/**
 * Whether a link of this kind can open in the embedded browser here. The
 * browser is a native webview, so web access cannot use it; a local page also
 * needs the local backend, because with a remote backend the path names a
 * file on the other machine.
 */
export function canOpenInEmbeddedBrowser(kind: ChatLinkKind | null): boolean {
  if (kind === 'web') return isNativeApp()
  if (kind === 'page') return isLocalBackend()
  return false
}

/** A local page as `file://` URL, keeping its `?query` / `#fragment`. */
function resolvePageUrl(href: string): { path: string; url: string } | null {
  const [ref, suffix] = splitSuffix(href)
  const path = resolveLocalPath(ref)
  return path ? { path, url: `${toFileUrl(path)}${suffix}` } : null
}

function openPathInSystem(path: string): void {
  invoke('open_path_in_default_app', { path }).catch(error => {
    toast.error(`Failed to open ${path}: ${error}`)
  })
}

/**
 * Open a link from a chat response. Web links and local HTML pages open in
 * the embedded browser; `system: true` (Cmd/Ctrl-click or the external-link
 * button) opens them in the system browser instead. Other local files open
 * in the file viewer. Where the embedded browser is not available, web links
 * open in the system browser and local pages in the file viewer.
 *
 * Returns true when the link was handled (the caller should prevent the
 * default navigation).
 */
export function openChatLink(
  href: string | undefined,
  { system = false }: { system?: boolean } = {}
): boolean {
  const kind = classifyChatLink(href)
  if (!href || !kind) return false

  if (kind === 'web') {
    if (system || !canOpenInEmbeddedBrowser(kind)) {
      // Called synchronously, so web access keeps the click's popup permission.
      void openExternal(href).catch(error => {
        console.error('Failed to open external link', error)
      })
      return true
    }
    void openUrlInEmbeddedBrowser(href).then(opened => {
      if (!opened) void openExternal(href)
    })
    return true
  }

  if (kind === 'page' && canOpenInEmbeddedBrowser(kind)) {
    const page = resolvePageUrl(href)
    if (!page) return false
    if (system) {
      openPathInSystem(page.path)
      return true
    }
    void openUrlInEmbeddedBrowser(page.url).then(opened => {
      if (!opened) openPathInSystem(page.path)
    })
    return true
  }

  const path = resolveLocalPath(kind === 'page' ? splitSuffix(href)[0] : href)
  if (!path) return false
  useUIStore.getState().setViewingFilePath(path)
  return true
}
