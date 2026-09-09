import { memo } from 'react'
import { Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getLabelTextColor } from '@/lib/label-colors'
import type { LabelFilter, LabelFilterOption } from '@/lib/label-filter'

interface LabelFilterChipsProps {
  options: LabelFilterOption[]
  filter: LabelFilter
  onToggle: (labelName: string) => void
  onClear: () => void
  /** Sidebar chips sit in a narrow column and drop the counts. */
  variant?: 'default' | 'compact'
  className?: string
}

/**
 * The label filter control shared by Home, the sidebar, and the canvas.
 *
 * A chip is a toggle. Selecting none means "show everything", so there is no
 * separate "All" chip to keep in step with the selection.
 */
export const LabelFilterChips = memo(function LabelFilterChips({
  options,
  filter,
  onToggle,
  onClear,
  variant = 'default',
  className,
}: LabelFilterChipsProps) {
  if (options.length === 0) return null

  const compact = variant === 'compact'

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      role="group"
      aria-label="Filter by label"
    >
      {!compact && (
        <Tag
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      )}

      {options.map(option => {
        const selected = filter.has(option.name.toLowerCase())
        return (
          <button
            key={option.name}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(option.name)}
            title={`${option.name} (${option.count})`}
            className={cn(
              'flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
              selected
                ? 'border-transparent font-medium'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            )}
            style={
              selected
                ? {
                    backgroundColor: option.color,
                    color: getLabelTextColor(option.color),
                  }
                : undefined
            }
          >
            {!selected && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: option.color }}
                aria-hidden="true"
              />
            )}
            <span className="truncate">{option.name}</span>
            {!compact && (
              <span className="tabular-nums opacity-70">{option.count}</span>
            )}
          </button>
        )
      })}

      {filter.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3" aria-hidden="true" />
          Clear
        </button>
      )}
    </div>
  )
})
