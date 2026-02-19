import { Kbd } from '@/components/ui/kbd'
import { formatShortcutDisplay, type ShortcutString } from '@/types/keybindings'
import { cn } from '@/lib/utils'

export interface KeybindingHint {
  /** Shortcut string e.g. 'mod+shift+n' or a display string like 'j/k' */
  shortcut: ShortcutString
  /** Label describing the action e.g. 'new worktree' */
  label: string
}

interface KeybindingHintsProps {
  hints: KeybindingHint[]
  className?: string
}

/**
 * A footer bar showing keyboard shortcut hints.
 * Styled to match the reference image with muted colors and subtle border.
 */
export function KeybindingHints({ hints, className }: KeybindingHintsProps) {
  if (hints.length === 0) return null

  return (
    <div
      className={cn(
        'absolute bottom-4 left-4 z-10 hidden sm:inline-flex w-fit items-end lg:items-center gap-3 lg:gap-4 rounded border border-border/30 bg-background/60 px-3 py-2 lg:py-1.5 backdrop-blur-md',
        className
      )}
    >
      {hints.map(hint => (
        <div
          key={hint.shortcut}
          className="flex flex-col lg:flex-row items-center gap-0.5 lg:gap-1.5 text-xs text-muted-foreground"
        >
          <Kbd className="h-5 px-1.5 text-[11px]">
            {formatShortcutDisplay(hint.shortcut)}
          </Kbd>
          <span className="text-[10px] lg:text-xs leading-none">
            {hint.label}
          </span>
        </div>
      ))}
    </div>
  )
}
