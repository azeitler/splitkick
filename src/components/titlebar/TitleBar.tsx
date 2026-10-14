import { cn } from '@/lib/utils'
import { PRODUCT_NAME } from '@/lib/build-info'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/store/ui-store'
import { Minimize2 } from 'lucide-react'
import { isNativeApp } from '@/lib/environment'

interface TitleBarProps {
  className?: string
  title?: string
  hideTitle?: boolean
}

/**
 * The phone title bar. A phone shows it only in zen mode (see MainWindow),
 * where it is the one way out: zen hides the tab bar and the session header.
 * Everything else a bar could carry lives elsewhere on a phone — Settings
 * behind the Home gear, usage on the Usage tab, the unread count on Home, the
 * file browser in the session header.
 *
 * The desktop window chrome is `WindowToolbar` plus the sidebar header and
 * footer (`src/components/toolbar/`, `src/components/sidebar/`).
 */
export function TitleBar({
  className,
  title = PRODUCT_NAME,
  hideTitle = false,
}: TitleBarProps) {
  const zenMode = useUIStore(state => state.zenMode)
  const toggleZenMode = useUIStore(state => state.toggleZenMode)
  const native = isNativeApp()

  const barClass = cn(
    'relative flex h-[var(--titlebar-height)] w-full shrink-0 items-center justify-between',
    // Pad out the status bar / notch so items-center centres the content in
    // the strip below it, while the background still paints behind it.
    'pt-[var(--safe-area-top)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)]',
    'bg-background/80 md:px-2',
    native ? 'z-[60]' : 'z-50',
    className
  )
  const dragRegion = native ? { 'data-tauri-drag-region': true } : {}

  return (
    <div {...dragRegion} className={barClass} data-testid="titlebar-mobile">
      <span className="min-w-0 flex-1 truncate px-12 text-center text-sm font-semibold text-foreground">
        {hideTitle ? '' : title}
      </span>
      {zenMode && (
        <Button
          onClick={toggleZenMode}
          variant="ghost"
          size="icon"
          className="absolute right-[calc(var(--safe-area-right)+0.25rem)] bottom-0 size-11 rounded-none text-foreground/70 hover:text-foreground"
          aria-label="Exit zen mode"
          data-testid="toggle-zen-mode"
        >
          <Minimize2 className="size-4" />
        </Button>
      )}
    </div>
  )
}

export default TitleBar
