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
