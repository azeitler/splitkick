import { createContext } from 'react'
import { toast } from 'sonner'
import { isLocalBackend, isNativeApp } from '@/lib/environment'
import {
  isBrowsableFile,
  splitFileRefSuffix,
  toFileUrl,
} from '@/lib/path-utils'
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
 * - `page`: a local file the embedded browser renders itself — an HTML page,
 *   an image, a PDF, a movie or plain text (see `isBrowsableFile`).
 * - `file`: any other local file, which the file viewer shows.
 */
export type ChatLinkKind = 'web' | 'page' | 'file'

/**
 * Worktree path that relative links and images in chat markdown resolve
 * against. A session opened from the project canvas renders in a modal whose
 * worktree is not the store's active worktree (the canvas clears it), so the
 * modal provides its own path here. Null falls back to the active worktree.
 */
export const LocalPathRootContext = createContext<string | null>(null)

/**
 * Strip a reference down to the path it names, without resolving it.
 *
 * Drops a `file://` scheme, percent-decodes, and refuses an anchor or any
 * other URL scheme. The result may still be relative — deciding what it is
 * relative to is the caller's job (`resolveLocalPath` joins it against one
 * root; `buildFileReferenceCandidates` offers several).
 *
 * @example
 * toLocalReferencePath('file:///my%20docs/api.md') // '/my docs/api.md'
 * toLocalReferencePath('docs/api.md') // 'docs/api.md'
 * toLocalReferencePath('https://example.com/a.md') // null
 */
export function toLocalReferencePath(ref: string | undefined): string | null {
  if (!ref || ref.startsWith('#')) return null

  let path = ref
  if (/^file:/i.test(path)) {
    path = path.replace(/^file:(\/\/)?/i, '').replace(/^\/(?=[a-z]:)/i, '')
  } else if (URL_SCHEME_RE.test(path) && !WINDOWS_DRIVE_RE.test(path)) {
    return null
  }

  try {
    return decodeURIComponent(path)
  } catch {
    // Malformed percent-encoding: keep the raw reference.
    return path
  }
}

/**
 * Resolve a markdown link/image reference to a local filesystem path.
 * Absolute paths (POSIX, Windows drive, file://) are returned decoded;
 * relative paths resolve against `rootPath`, or the active worktree when it
 * is not given. Returns null for anchors, other URL schemes, or relative
 * paths without a root.
 */
export function resolveLocalPath(
  ref: string | undefined,
  rootPath?: string | null
): string | null {
  const path = toLocalReferencePath(ref)
  if (path === null) return null

  if (path.startsWith('/') || WINDOWS_DRIVE_RE.test(path)) return path

  const root = rootPath || useChatStore.getState().activeWorktreePath
  if (!root) return null
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${path.replace(/^[\\/]+/, '')}`
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
  return isBrowsableFile(splitFileRefSuffix(href)[0]) ? 'page' : 'file'
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
function resolvePageUrl(
  href: string,
  rootPath: string | null | undefined
): { path: string; url: string } | null {
  const [ref, suffix] = splitFileRefSuffix(href)
  const path = resolveLocalPath(ref, rootPath)
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
 * open in the system browser and local pages in the file viewer. Relative
 * paths resolve against `rootPath` (see `resolveLocalPath`).
 *
 * Returns true when the link was handled (the caller should prevent the
 * default navigation).
 */
export function openChatLink(
  href: string | undefined,
  {
    system = false,
    rootPath,
    resolvedPath,
  }: {
    system?: boolean
    rootPath?: string | null
    /**
     * The path `useFileReference` confirmed exists. Given, it wins: it was
     * resolved against the session's tool calls and checked on disk, where
     * `rootPath` can only join and hope.
     */
    resolvedPath?: string | null
  } = {}
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
    const page = resolvedPath
      ? {
          path: resolvedPath,
          url: `${toFileUrl(resolvedPath)}${splitFileRefSuffix(href)[1]}`,
        }
      : resolvePageUrl(href, rootPath)
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

  const path =
    resolvedPath ??
    resolveLocalPath(
      kind === 'page' ? splitFileRefSuffix(href)[0] : href,
      rootPath
    )
  if (!path) return false
  useUIStore.getState().setViewingFilePath(path)
  return true
}
