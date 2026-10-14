import { forwardRef } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/store/ui-store'
import { isNativeApp } from '@/lib/environment'
import { formatShortcutDisplay } from '@/types/keybindings'
import { toolbarButtonClass } from './WindowToolbar'

const fieldClass =
  'flex h-7 items-center gap-1.5 rounded-md bg-foreground/[0.07] px-2 text-[0.8125rem] text-muted-foreground'

/** Toolbar search that opens the command palette (no view search to offer). */
export function ToolbarPaletteSearch() {
  const open = () => useUIStore.getState().setCommandPaletteOpen(true)
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Go to"
        data-testid="toolbar-search-palette"
        className={cn(
          fieldClass,
          'w-44 cursor-pointer hover:bg-foreground/10 @max-[720px]:hidden'
        )}
      >
        <Search className="size-3.5" />
        <span>Go to…</span>
        {isNativeApp() && (
          <kbd className="ml-auto text-[0.6875rem] opacity-70">
            {formatShortcutDisplay('mod+k')}
          </kbd>
        )}
      </button>
      <Button
        onClick={open}
        variant="ghost"
        size="icon"
        aria-label="Go to"
        className={cn(toolbarButtonClass, 'hidden @max-[720px]:inline-flex')}
      >
        <Search />
      </Button>
    </>
  )
}

interface ToolbarFilterSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
}

/** Toolbar search that filters the view on screen. Narrows instead of
 * collapsing: an icon could not hold the text being filtered. */
export const ToolbarFilterSearch = forwardRef<
  HTMLInputElement,
  ToolbarFilterSearchProps
>(function ToolbarFilterSearch(
  { value, onChange, placeholder, onKeyDown },
  ref
) {
  return (
    <label className={cn(fieldClass, 'w-52 @max-[720px]:w-32')}>
      <Search className="size-3.5 shrink-0" />
      <input
        ref={ref}
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  )
})
