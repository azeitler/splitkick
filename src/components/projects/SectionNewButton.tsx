import { Plus } from 'lucide-react'

/** The "+ New" button at the right edge of a sidebar section header. */
export function SectionNewButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-xs text-muted-foreground hover:bg-accent-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      <Plus className="size-3" aria-hidden="true" />
      New
    </button>
  )
}
