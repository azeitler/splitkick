import { Pin } from 'lucide-react'

/** The small pin that marks a session pinned to its project, on its row. */
export function PinGlyph() {
  return (
    <Pin
      data-testid="pinned-glyph"
      aria-label="Pinned"
      className="size-2.5 shrink-0 fill-sky-500 text-sky-500"
    />
  )
}
