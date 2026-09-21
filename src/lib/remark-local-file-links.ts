/**
 * remark plugin: turn local file paths in plain text into links.
 *
 * Agents often print where they wrote a file, e.g. "Open /tmp/report.html"
 * or "see out/chart.svg". GFM autolinks only cover web URLs, so these paths
 * stay plain text. This plugin splits them out of text nodes into `link`
 * nodes, which the markdown link renderer then opens in the embedded browser.
 *
 * It also links a web URL inside inline code. GFM never autolinks inside a
 * code span, so `` `http://localhost:5174/#/demo` `` — the form agents use
 * for a dev-server address — stayed plain text while the same URL in prose
 * became a link.
 *
 * Only paths the browser can show are matched (`isBrowsableFile`): HTML
 * pages, images, PDFs, movies and plain text. Code blocks, existing links and
 * raw HTML are left alone.
 *
 * Two rules, because prose and inline code carry different certainty:
 *
 * - **Plain text** uses a conservative pattern. A path must not hold spaces,
 *   because prose gives no way to tell where "see report file.html" ends.
 *   Letters of any script are allowed, so `übersicht-日本.html` matches.
 * - **Inline code** that holds exactly one path is wrapped whole. The
 *   backticks mark the ends, so a `#` or a `?` inside the name is no longer
 *   ambiguous and `` `q#1?draft.html` `` works. A space still is: nothing
 *   tells `` `open out/report.html` `` (a command) from `` `04 report.html` ``
 *   (a name), so neither is linked. Write the second as a markdown link.
 */

import type { MdastNode } from '@/lib/remark-fix-interrupted-lists'
import {
  browsableExtensions,
  isBrowsableFile,
  splitFileRefSuffix,
} from '@/lib/path-utils'

// Longest first, so `html` wins over `htm` whatever the Set order is.
const EXT = browsableExtensions()
  .sort((a, b) => b.length - a.length)
  .join('|')
// A path segment in prose: letters of any script, digits and the punctuation
// that turns up in real file names. No space — see the note above.
const SEG = '[\\p{L}\\p{N}_.@%+=-]+'
const PATH =
  `(?:file:\\/\\/\\/?(?:[A-Za-z]:\\/)?(?:${SEG}\\/)*${SEG}\\.(?:${EXT})` +
  `|[A-Za-z]:[\\\\/](?:${SEG}[\\\\/])*${SEG}\\.(?:${EXT})` +
  `|(?:~\\/|\\.{1,2}\\/|\\/)?(?:${SEG}\\/)*${SEG}\\.(?:${EXT}))` +
  '(?:#[\\p{L}\\p{N}._-]*)?'
// The path must start the text or follow whitespace or an opening bracket or
// quote, and must not run on into more path characters (`index.html.bak`).
const BOUNDARY_BEFORE = '(^|[\\s(\\[{"\'<])'
const BOUNDARY_AFTER = '(?![\\p{L}\\p{N}/\\\\-]|\\.\\p{L})'

// `i`: an extension is matched case-insensitively, like `isBrowsableFile`.
const LOCAL_FILE_PATH_RE = new RegExp(
  `${BOUNDARY_BEFORE}(${PATH})${BOUNDARY_AFTER}`,
  'giu'
)

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

/**
 * Whether inline code holds exactly one link: a local file path, or a web
 * URL.
 *
 * Looser than the prose pattern in one way only: the backticks delimit the
 * reference, so a `#` or a `?` inside a file name is safe. Whitespace still
 * is not, because a shell command (`open out/report.html`) reads the same as
 * a name with a space.
 *
 * A web URL needs no extension test — every http(s) address opens in the
 * pane. Other schemes (`ssh://`, `postgres://`) are left as code.
 */
function inlineCodeLinkTarget(text: string): string | null {
  const value = text.trim()
  if (!value || /\s/.test(value)) return null
  if (/^https?:\/\//i.test(value)) return value
  // Any other scheme except file:// is not a link Jean can open.
  if (/^(?!file:)[a-z][a-z\d+.-]*:\/\//i.test(value)) return null
  return isBrowsableFile(splitFileRefSuffix(value)[0]) ? value : null
}

function linkTo(url: string, child: MdastNode): MdastNode {
  return { type: 'link', url, title: null, children: [child] }
}

function splitText(value: string): MdastNode[] | null {
  const parts: MdastNode[] = []
  let last = 0
  for (const match of value.matchAll(LOCAL_FILE_PATH_RE)) {
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
    } else if (child.type === 'inlineCode' && value !== null) {
      const url = inlineCodeLinkTarget(value)
      if (url) {
        next.push(linkTo(url, child))
        changed = true
        continue
      }
    } else {
      visit(child)
    }
    next.push(child)
  }
  if (changed) node.children = next
}

export function remarkLocalFileLinks() {
  return (tree: MdastNode) => {
    visit(tree)
  }
}
