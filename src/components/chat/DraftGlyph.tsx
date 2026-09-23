import { Pencil } from 'lucide-react'

/** The small pencil that marks a session holding an unsent message. */
export function DraftGlyph() {
  return (
    <Pencil
      data-testid="draft-glyph"
      aria-label="Unsent draft"
      className="size-3 shrink-0 text-muted-foreground"
    />
  )
}
