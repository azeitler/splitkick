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
        'absolute bottom-4 left-4 z-10 hidden sm:inline-flex w-fit items-center gap-4 rounded border border-border/30 bg-background/60 px-3 py-1.5 backdrop-blur-md',
        className
      )}
    >
      {hints.map((hint, index) => (
        <div
          key={index}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Kbd className="h-5 px-1.5 text-[11px]">
            {formatShortcutDisplay(hint.shortcut)}
          </Kbd>
          <span>{hint.label}</span>
        </div>
      ))}
    </div>
  )
}
