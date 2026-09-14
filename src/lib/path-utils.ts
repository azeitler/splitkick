/**
 * Cross-platform path utilities
 *
 * These utilities handle path operations that work correctly on both
 * Windows (backslash separators) and Unix systems (forward slash).
 */

/**
 * Extract the filename from a path (cross-platform)
 *
 * Handles both forward slashes (Unix) and backslashes (Windows).
 *
 * @example
 * getFilename('/Users/test/file.txt') // 'file.txt'
 * getFilename('C:\\Users\\test\\file.txt') // 'file.txt'
 * getFilename('file.txt') // 'file.txt'
 */
export function getFilename(path: string): string {
  // Normalize backslashes to forward slashes, then split
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

/**
 * Normalize path separators to forward slashes
 *
 * Useful for consistent display and comparison of paths.
 *
 * @example
 * normalizePath('C:\\Users\\test') // 'C:/Users/test'
 * normalizePath('/Users/test') // '/Users/test'
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Get the directory part of a path (cross-platform)
 *
 * @example
 * getDirname('/Users/test/file.txt') // '/Users/test'
 * getDirname('C:\\Users\\test\\file.txt') // 'C:/Users/test'
 */
export function getDirname(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) return '.'
  if (lastSlash === 0) return '/'
  return normalized.slice(0, lastSlash)
}

/**
 * Get the file extension (cross-platform)
 *
 * @example
 * getExtension('file.txt') // '.txt'
 * getExtension('file') // ''
 * getExtension('.gitignore') // ''
 */
export function getExtension(path: string): string {
  const filename = getFilename(path)
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) return ''
  return filename.slice(lastDot)
}

/**
 * Join a root directory path with a relative path (cross-platform).
 * Uses the separator style of the root when it looks Windows-like.
 */
export function joinPaths(root: string, relative: string): string {
  if (!relative) return root
  if (!root) return relative
  const usesBackslash = root.includes('\\') && !root.includes('/')
  const sep = usesBackslash ? '\\' : '/'
  const cleanRoot = root.replace(/[\\/]+$/, '')
  const cleanRelative = relative.replace(/^[\\/]+/, '').replace(/[\\/]+/g, sep)
  return `${cleanRoot}${sep}${cleanRelative}`
}

/** Extensions a web view renders as a page when it loads the file from disk. */
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml', '.xht', '.shtml'])

/**
 * Whether a path names an HTML document (case-insensitive).
 *
 * Covers the extensions WebKit, WebView2 and WebKitGTK render directly.
 * Template formats (`.ejs`, `.hbs`, `.vue`) and web archives (`.mhtml`) are
 * excluded: they need a build step or are not supported by every engine.
 *
 * @example
 * isHtmlFile('site/index.HTML') // true
 * isHtmlFile('page.xhtml') // true
 * isHtmlFile('App.vue') // false
 */
export function isHtmlFile(path: string): boolean {
  return HTML_EXTENSIONS.has(getExtension(path).toLowerCase())
}

// The sets below are the extensions a web view renders as a document of its
// own, without HTML around them. Each one was checked with a headless
// `WKWebView` probe against a local file: all report `canShowMIMEType == true`
// and paint. See docs/developer/embedded-browser.md for the full table.

const IMAGE_EXTENSIONS = new Set([
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.apng',
])
const PDF_EXTENSIONS = new Set(['.pdf'])

/**
 * Plain-text extensions. These become a text document, but WebKit has no
 * charset for a `file://` text response and falls back to Latin-1, so
 * non-ASCII characters show as mojibake. The file viewer renders Markdown
 * properly and stays available as "Open" in the context menu.
 */
const TEXT_EXTENSIONS = new Set(['.txt', '.text', '.log', '.md', '.markdown'])

/**
 * Movie extensions. A movie is special: WebKit replaces the page with a media
 * document and reports the navigation as *failed*
 * (`WebKitErrorDomain 204 "Plug-in handled load"`), even though the player
 * appears and plays. The load therefore never reports "finished" — see
 * `isVideoFile` for what the browser pane does about it.
 *
 * `.mkv` is left out: WebKit cannot play the Matroska container.
 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv'])

/**
 * Whether a movie file is at this path (case-insensitive).
 *
 * The browser pane needs this because a movie never reports a finished load.
 *
 * @example
 * isVideoFile('clip.MP4') // true
 * isVideoFile('poster.png') // false
 */
export function isVideoFile(path: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(path).toLowerCase())
}

/**
 * Whether the embedded browser can show the file at this path directly.
 *
 * True for HTML pages, images (SVG included), PDFs, movies and plain text.
 * Everything else — source code, archives, binaries — goes to the file
 * viewer instead.
 *
 * @example
 * isBrowsableFile('report.html') // true
 * isBrowsableFile('diagram.SVG') // true
 * isBrowsableFile('clip.mp4') // true
 * isBrowsableFile('main.rs') // false
 */
export function isBrowsableFile(path: string): boolean {
  const extension = getExtension(path).toLowerCase()
  return (
    HTML_EXTENSIONS.has(extension) ||
    IMAGE_EXTENSIONS.has(extension) ||
    PDF_EXTENSIONS.has(extension) ||
    TEXT_EXTENSIONS.has(extension) ||
    VIDEO_EXTENSIONS.has(extension)
  )
}

/**
 * Split a file reference into its path and its `?query` / `#fragment`.
 *
 * `#` and `?` are legal in a file name on every platform Jean runs on, so the
 * first one is not always the start of a suffix. The extension decides:
 *
 * - `report.html#top` → the part before `#` is a page, so `#top` is a suffix.
 * - `q#1?draft.html` → it is not, but the whole string is a page, so the
 *   whole string is the name.
 *
 * @example
 * splitFileRefSuffix('report.html#top') // ['report.html', '#top']
 * splitFileRefSuffix('q#1?draft.html') // ['q#1?draft.html', '']
 * splitFileRefSuffix('page.html?v=2') // ['page.html', '?v=2']
 */
export function splitFileRefSuffix(ref: string): [string, string] {
  const index = ref.search(/[?#]/)
  if (index === -1) return [ref, '']
  const head = ref.slice(0, index)
  // A suffix on a browsable file is a real suffix.
  if (isBrowsableFile(head)) return [head, ref.slice(index)]
  // Otherwise the `#` or `?` may belong to the name itself.
  if (isBrowsableFile(ref)) return [ref, '']
  return [head, ref.slice(index)]
}

/** Every extension the embedded browser opens, without the leading dot. */
export function browsableExtensions(): string[] {
  return [
    ...HTML_EXTENSIONS,
    ...IMAGE_EXTENSIONS,
    ...PDF_EXTENSIONS,
    ...TEXT_EXTENSIONS,
    ...VIDEO_EXTENSIONS,
  ].map(extension => extension.slice(1))
}

/**
 * Convert an absolute filesystem path to a `file://` URL (cross-platform).
 *
 * Each path segment is percent-encoded on its own, so separators survive and
 * relative links inside an HTML page (`css/site.css`) resolve next to it.
 * `encodeURI` is not enough: it leaves `#` and `?` in place, which would cut
 * the path into a fragment or a query.
 *
 * @example
 * toFileUrl('/Users/me/my site/index.html') // 'file:///Users/me/my%20site/index.html'
 * toFileUrl('C:\\site\\index.html') // 'file:///C:/site/index.html'
 * toFileUrl('\\\\wsl.localhost\\Ubuntu\\x.html') // 'file://wsl.localhost/Ubuntu/x.html'
 */
export function toFileUrl(absolutePath: string): string {
  const normalized = normalizePath(absolutePath)
  const encodeSegments = (path: string) =>
    path.split('/').map(encodeURIComponent).join('/')

  // UNC path (//host/share/...): the host goes into the URL authority.
  if (normalized.startsWith('//')) {
    const rest = normalized.slice(2)
    const slash = rest.indexOf('/')
    const host = slash === -1 ? rest : rest.slice(0, slash)
    const path = slash === -1 ? '' : rest.slice(slash)
    return `file://${host}${encodeSegments(path)}`
  }

  // Windows drive path: keep the drive letter and colon unencoded.
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized.slice(0, 2)}${encodeSegments(normalized.slice(2))}`
  }

  return `file://${encodeSegments(normalized)}`
}
