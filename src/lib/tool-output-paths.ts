/**
 * Find file and folder paths in tool output (`ls`, `grep -n`, `git status`).
 *
 * Tool output is plain text, not markdown, so `remarkLocalFileLinks` cannot
 * run on it. Each whitespace-separated token instead goes through the same
 * test inline code uses (`pathLikeInlineCode`), after two clean-ups that tool
 * output needs:
 *
 * - Brackets, quotes and trailing punctuation around a token are not part of
 *   the path (`(src/a.ts)`, `src/a.ts,`).
 * - grep's `path:12:` and `path:12:3:` prefixes name a file at a line. The
 *   link covers `path:12`; only `path` is checked on disk.
 *
 * A token is only a candidate. The backend (`check_paths`) says which ones
 * exist, and only those become links. The segments always join back to the
 * exact input text.
 */

import { pathLikeInlineCode } from '@/lib/remark-local-file-links'

/** Most distinct paths checked per output. Later candidates stay text. */
export const MAX_TOOL_OUTPUT_PATHS = 200

export interface ToolOutputSegment {
  text: string
  /** The path to check, when this segment is a candidate link. */
  path?: string
}

export interface TokenizedToolOutput {
  segments: ToolOutputSegment[]
  /** Distinct candidate paths, in order of appearance. */
  paths: string[]
}

const LEADING_RE = /^[([{<"'`]+/
const TRAILING_RE = /[)\]}>"'`,;:.!?]+$/
// `path:12`, `path:12:3`, each optionally followed by `:` and the match text.
const GREP_RE = /^(.+?)(:\d+(?::\d+)?)(?::|$)/

/** The candidate inside one token: where it starts, the link text, the path. */
function candidateIn(
  token: string
): { start: number; text: string; path: string } | null {
  const start = token.match(LEADING_RE)?.[0].length ?? 0
  let core = token.slice(start).replace(TRAILING_RE, '')
  if (!core) return null
  const grep = core.match(GREP_RE)
  const path = grep ? (grep[1] ?? '') : core
  if (grep) core = `${grep[1]}${grep[2]}`
  if (!pathLikeInlineCode(path)) return null
  return { start, text: core, path }
}

export function tokenizeToolOutput(text: string): TokenizedToolOutput {
  const segments: ToolOutputSegment[] = []
  const paths: string[] = []
  const seen = new Set<string>()
  let last = 0

  const pushText = (value: string) => {
    if (!value) return
    const previous = segments[segments.length - 1]
    if (previous && previous.path === undefined) previous.text += value
    else segments.push({ text: value })
  }

  for (const match of text.matchAll(/\S+/g)) {
    const candidate = candidateIn(match[0])
    if (!candidate) continue
    if (!seen.has(candidate.path)) {
      if (seen.size >= MAX_TOOL_OUTPUT_PATHS) continue
      seen.add(candidate.path)
      paths.push(candidate.path)
    }
    const start = (match.index ?? 0) + candidate.start
    pushText(text.slice(last, start))
    segments.push({ text: candidate.text, path: candidate.path })
    last = start + candidate.text.length
  }
  pushText(text.slice(last))

  return { segments, paths }
}
