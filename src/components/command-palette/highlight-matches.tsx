import { useMemo } from 'react'
import { cn } from '@/lib/utils'

export interface TextSegment {
  text: string
  match: boolean
}

/**
 * Split `text` into alternating matched and unmatched runs for `query`.
 *
 * Matching is case-insensitive and literal — no regex — so a query containing
 * `.` or `(` highlights those characters instead of behaving like a pattern.
 * This mirrors `search_session_messages`, which matches the whole query as one
 * substring, so what gets highlighted is exactly what the search matched on.
 */
export function splitHighlightSegments(
  text: string,
  query: string
): TextSegment[] {
  const needle = query.trim().toLowerCase()
  if (!needle || !text) return [{ text, match: false }]

  const haystack = text.toLowerCase()
  // Lowercasing changes length for a few characters (for example 'İ'), which
  // would misalign every slice taken from the original. Highlighting is a nicety,
  // so drop it rather than render corrupted text.
  if (haystack.length !== text.length) return [{ text, match: false }]

  const segments: TextSegment[] = []
  let cursor = 0

  for (;;) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) break
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), match: false })
    }
    segments.push({
      text: text.slice(index, index + needle.length),
      match: true,
    })
    cursor = index + needle.length
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false })
  }
  return segments.length > 0 ? segments : [{ text, match: false }]
}

interface HighlightedTextProps {
  text: string
  query: string
  className?: string
}

/** Renders `text` with every occurrence of `query` marked. */
export function HighlightedText({
  text,
  query,
  className,
}: HighlightedTextProps) {
  const segments = useMemo(
    () => splitHighlightSegments(text, query),
    [text, query]
  )

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            // Matches sit inside muted snippet text, so lift them to the normal
            // foreground colour instead of relying on the tint alone.
            className="rounded-[2px] bg-yellow-400/25 font-medium text-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </span>
  )
}

/** Convenience wrapper matching the muted snippet styling used in the palette. */
export function HighlightedSnippet({
  text,
  query,
  className,
}: HighlightedTextProps) {
  return (
    <HighlightedText
      text={text}
      query={query}
      className={cn('text-muted-foreground', className)}
    />
  )
}
