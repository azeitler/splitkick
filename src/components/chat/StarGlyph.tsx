import { Star } from 'lucide-react'

/** The small star that marks a starred session on its row. */
export function StarGlyph() {
  return (
    <Star
      data-testid="starred-glyph"
      aria-label="Starred"
      className="size-2.5 shrink-0 fill-amber-400 text-amber-400"
    />
  )
}
