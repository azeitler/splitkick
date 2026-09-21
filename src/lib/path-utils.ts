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

/**
 * Whether a path is absolute (POSIX root or a Windows drive).
 *
 * @example
 * isAbsolutePath('/repo/docs/api.md') // true
 * isAbsolutePath('C:\\repo\\api.md') // true
 * isAbsolutePath('docs/api.md') // false
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

/**
 * Whether a path starts at the user's home directory (`~` or `~/…`).
 *
 * Only the backend can expand it: the frontend does not know the home
 * directory, and with a remote backend it is another machine's home anyway.
 * `~user/…` is not recognised.
 *
 * @example
 * isHomeRelativePath('~/Downloads/report.html') // true
 * isHomeRelativePath('~') // true
 * isHomeRelativePath('docs/~draft.md') // false
 */
export function isHomeRelativePath(path: string): boolean {
  return /^~(?:[\\/]|$)/.test(path)
}

const DOT_SEGMENT_RE = /(^|[\\/])\.{1,2}([\\/]|$)/

/**
 * Resolve `.` and `..` segments without touching the filesystem.
 *
 * A path without such segments comes back exactly as given, separators
 * included. Otherwise it comes back with forward slashes, which every
 * platform Jean runs on accepts. In an absolute path nothing climbs above
 * the root. In a relative path a leading `..` is kept, because the base it
 * climbs out of is not known here. UNC paths are left alone.
 *
 * @example
 * normalizeDotSegments('/repo/worktree/../shared/api.md') // '/repo/shared/api.md'
 * normalizeDotSegments('a/../../x.md') // '../x.md'
 * normalizeDotSegments('C:\\repo\\..\\x.md') // 'C:/x.md'
 * normalizeDotSegments('docs/api.md') // 'docs/api.md'
 */
export function normalizeDotSegments(path: string): string {
  if (!DOT_SEGMENT_RE.test(path)) return path
  const normalized = normalizePath(path)
  if (normalized.startsWith('//')) return path

  const drive = /^[a-zA-Z]:/.exec(normalized)?.[0] ?? ''
  const rest = normalized.slice(drive.length)
  const absolute = rest.startsWith('/')

  const out: string[] = []
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      const last = out[out.length - 1]
      if (last !== undefined && last !== '..') out.pop()
      else if (!absolute) out.push('..')
      continue
    }
    out.push(segment)
  }

  const body = out.join('/')
  if (absolute) return `${drive}/${body}`
  return body || '.'
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

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

/**
 * Plain-text extensions. The pane does not give these to the web view: a
 * `file://` text response carries no charset, so WebKit falls back to Latin-1
 * and every non-ASCII character becomes mojibake, and Markdown shows as its
 * own source. `BrowserTextContent` reads the file and renders it instead.
 */
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.text',
  '.log',
  ...MARKDOWN_EXTENSIONS,
])

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
 * Whether a path names a plain-text file (case-insensitive).
 *
 * The browser pane renders these itself instead of loading them into the web
 * view. See `TEXT_EXTENSIONS` for why.
 *
 * @example
 * isTextFile('notes.MD') // true
 * isTextFile('main.rs') // false
 */
export function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(getExtension(path).toLowerCase())
}

/**
 * Whether a path names a Markdown document (case-insensitive).
 *
 * @example
 * isMarkdownFile('README.md') // true
 * isMarkdownFile('notes.txt') // false
 */
export function isMarkdownFile(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(getExtension(path).toLowerCase())
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

/**
 * Whether the browser pane renders this URL as text of its own, instead of
 * giving it to the web view.
 *
 * Only a local file qualifies. A Markdown file served over http(s) stays with
 * the web view, which is the browser the user asked for there.
 *
 * @example
 * isPaneTextUrl('file:///docs/notes.md#top') // true
 * isPaneTextUrl('file:///site/index.html') // false
 * isPaneTextUrl('https://example.com/readme.md') // false
 */
export function isPaneTextUrl(url: string): boolean {
  if (!/^file:/i.test(url)) return false
  return isTextFile(splitFileRefSuffix(url)[0])
}
