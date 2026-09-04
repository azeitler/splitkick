import { useCallback } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SessionFilterInputProps {
  value: string
  onChange: (value: string) => void
  /** Called by Escape and by the clear button. */
  onClose: () => void
  placeholder: string
  /** Indentation only — the field always fills the width it is given. */
  className?: string
  inputTestId: string
}

/**
 * Compact filter field rendered as its own row below a project or worktree row.
 *
 * It sits below rather than inside the row on purpose: both rows are already
 * full of badges and git counters, and this is the only placement that survives
 * a narrow sidebar.
 */
export function SessionFilterInput({
  value,
  onChange,
  onClose,
  placeholder,
  className,
  inputTestId,
}: SessionFilterInputProps) {
  // Callback ref instead of an effect — matches the inline-rename inputs.
  const focusRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        // Without this the key also reaches the global transient-UI dismiss
        // handlers and any open modal above the sidebar.
        event.stopPropagation()
        onClose()
        return
      }
      // Keep typing away from the row's Enter/Space activation and from the
      // canvas arrow-key navigation.
      event.stopPropagation()
      if (event.key === 'Enter') event.preventDefault()
    },
    [onClose]
  )

  return (
    <div
      className={cn('relative min-w-0', className)}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
    >
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={focusRef}
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={inputTestId}
        className="h-7 pl-7 pr-7 text-xs md:text-xs"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Clear session filter"
        className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent-foreground/10 hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
