/**
 * remark plugin: turn local HTML file paths in plain text into links.
 *
 * Agents often print where they wrote a page, e.g. "Open /tmp/report.html"
 * or "see out/index.html". GFM autolinks only cover web URLs, so these paths
 * stay plain text. This plugin splits them out of text nodes into `link`
 * nodes, which the markdown link renderer then opens in the embedded browser.
 *
 * Matches absolute POSIX paths, Windows drive paths, `file://` URLs and
 * relative paths that end in an HTML extension (see `isHtmlFile`), with an
 * optional `#fragment`. Paths with spaces and `~/` paths are not matched.
 * Inline code that holds exactly one such path (`` `out/report.html` ``) is
 * wrapped in a link. Code blocks, existing links and raw HTML are left alone.
 */

import type { MdastNode } from '@/lib/remark-fix-interrupted-lists'

const EXT = '(?:html?|xhtml?|xht|shtml)'
const SEG = '[\\w.@%+=-]+'
const PATH =
  `(?:file:\\/\\/\\/?(?:[A-Za-z]:\\/)?(?:${SEG}\\/)*${SEG}\\.${EXT}` +
  `|[A-Za-z]:[\\\\/](?:${SEG}[\\\\/])*${SEG}\\.${EXT}` +
  `|(?:\\.{1,2}\\/|\\/)?(?:${SEG}\\/)*${SEG}\\.${EXT})` +
  '(?:#[\\w.-]*)?'
// The path must start the text or follow whitespace or an opening bracket or
// quote, and must not run on into more path characters (`index.html.bak`).
const BOUNDARY_BEFORE = '(^|[\\s(\\[{"\'<])'
const BOUNDARY_AFTER = '(?![\\w/\\\\-]|\\.\\w)'

const LOCAL_HTML_PATH_RE = new RegExp(
  `${BOUNDARY_BEFORE}(${PATH})${BOUNDARY_AFTER}`,
  'g'
)
const WHOLE_LOCAL_HTML_PATH_RE = new RegExp(`^${PATH}$`)

/** Nodes whose text must stay as written. */
const SKIP = new Set([
  'link',
  'linkReference',
  'definition',
  'inlineCode',
  'code',
  'html',
  'image',
  'imageReference',
])

/** Whether `text` is exactly one local HTML path (used for inline code). */
function isLocalHtmlPath(text: string): boolean {
  return WHOLE_LOCAL_HTML_PATH_RE.test(text.trim())
}

function linkTo(url: string, child: MdastNode): MdastNode {
  return { type: 'link', url, title: null, children: [child] }
}

function splitText(value: string): MdastNode[] | null {
  const parts: MdastNode[] = []
  let last = 0
  for (const match of value.matchAll(LOCAL_HTML_PATH_RE)) {
    const prefix = match[1] ?? ''
    const path = match[2] ?? ''
    const start = (match.index ?? 0) + prefix.length
    if (start > last)
      parts.push({ type: 'text', value: value.slice(last, start) })
    parts.push(linkTo(path, { type: 'text', value: path }))
    last = start + path.length
  }
  if (parts.length === 0) return null
  if (last < value.length)
    parts.push({ type: 'text', value: value.slice(last) })
  return parts
}

function visit(node: MdastNode): void {
  if (!node.children || SKIP.has(node.type)) return
  const next: MdastNode[] = []
  let changed = false
  for (const child of node.children) {
    const value = typeof child.value === 'string' ? child.value : null
    if (child.type === 'text' && value !== null) {
      const parts = splitText(value)
      if (parts) {
        next.push(...parts)
        changed = true
        continue
      }
    } else if (
      child.type === 'inlineCode' &&
      value !== null &&
      isLocalHtmlPath(value)
    ) {
      next.push(linkTo(value.trim(), child))
      changed = true
      continue
    } else {
      visit(child)
    }
    next.push(child)
  }
  if (changed) node.children = next
}

export function remarkLocalHtmlLinks() {
  return (tree: MdastNode) => {
    visit(tree)
  }
}
