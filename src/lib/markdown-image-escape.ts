/**
 * Agents often embed local images with raw filesystem paths, e.g.
 * `![shot](/Users/me/Library/Application Support/.../a.png)`. CommonMark ends
 * a bare link destination at the first space, so the embed renders as literal
 * text. Wrapping the destination in `<...>` is the CommonMark escape for
 * destinations with spaces (Jean's own Linear images use the same form).
 *
 * Fenced code blocks and inline code spans are left untouched so code
 * examples keep their exact source.
 */

// Any indent: fences nested in list items are indented past 3 spaces.
const FENCE_RE = /^\s*(`{3,}|~{3,})/
const INLINE_CODE_RE = /(`+)[\s\S]*?\1/g
const IMAGE_RE =
  /!\[([^\]\n]*)\]\((?!<)([^\n<>()]*?\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico))\)/gi

function escapeSegment(segment: string): string {
  return segment.replace(IMAGE_RE, (match, alt: string, dest: string) =>
    /\s/.test(dest) ? `![${alt}](<${dest.trim()}>)` : match
  )
}

function escapeLine(line: string): string {
  let result = ''
  let last = 0
  for (const code of line.matchAll(INLINE_CODE_RE)) {
    result += escapeSegment(line.slice(last, code.index)) + code[0]
    last = code.index + code[0].length
  }
  return result + escapeSegment(line.slice(last))
}

export function escapeMarkdownImageDestinations(text: string): string {
  if (!text.includes('![')) return text

  let fence: string | null = null
  return text
    .split('\n')
    .map(line => {
      const marker = FENCE_RE.exec(line)?.[1]
      if (fence) {
        // A closing fence uses the same character and is at least as long.
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
          fence = null
        }
        return line
      }
      if (marker) {
        fence = marker
        return line
      }
      return escapeLine(line)
    })
    .join('\n')
}
