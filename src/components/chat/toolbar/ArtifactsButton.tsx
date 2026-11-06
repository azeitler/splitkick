import { Package } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'

interface ArtifactsButtonProps {
  /** Registered artifacts. The button is hidden while there are none. */
  count: number
}

/**
 * Shortcut to the Artifacts tab of the left panel (#107), next to the
 * follow-ups button: opens the panel on that tab, or closes it there.
 */
export function ArtifactsButton({ count }: ArtifactsButtonProps) {
  const isMobile = useIsMobile()
  const open = useUIStore(
    state => state.fileBrowserVisible && state.contextPanelTab === 'artifacts'
  )

  if (count === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Artifacts (${count})`}
          aria-pressed={open}
          onClick={() => useUIStore.getState().toggleContextPanel('artifacts')}
          className={cn(
            isMobile ? 'h-11 w-11' : 'h-8 w-8',
            'relative flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground',
            open && 'bg-muted text-foreground'
          )}
        >
          <Package className="h-4 w-4" />
          <span
            data-testid="artifacts-badge"
            className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground tabular-nums"
          >
            {count > 99 ? '99+' : count}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>Artifacts</TooltipContent>
    </Tooltip>
  )
}
