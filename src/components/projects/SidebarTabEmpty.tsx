import type { ReactNode } from 'react'

/** The empty state of a sidebar tab: a glyph, one line, and a hint. */
export function SidebarTabEmpty({
  icon,
  title,
  hint,
  testId,
}: {
  icon: ReactNode
  title: string
  hint?: string
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-1 px-4 py-6 text-center text-muted-foreground/60 [&_svg]:size-4"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="text-sm">{title}</span>
      {hint && <span className="text-xs">{hint}</span>}
    </div>
  )
}
