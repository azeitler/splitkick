import { useCallback, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UsagePane } from '@/components/preferences/panes/UsagePane'
import { useUIStore } from '@/store/ui-store'
import { cn } from '@/lib/utils'

/**
 * Title bar entry point for the plan limits of every signed-in backend.
 * The pane mounts only while the popover is open, so the usage queries stay
 * idle until the user asks for them.
 */
export function UsagePopover() {
  const [open, setOpen] = useState(false)

  const openSettings = useCallback(() => {
    setOpen(false)
    useUIStore.getState().openPreferencesPane('usage')
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Usage"
              data-testid="titlebar-usage"
              className={cn(
                'h-6 w-6 rounded-none text-foreground/70 hover:text-foreground',
                open && 'bg-muted/50 text-foreground'
              )}
            >
              <BarChart3 className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Usage</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="max-h-[70vh] w-[22rem] overflow-y-auto p-3"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">Usage</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[11px]"
            onClick={openSettings}
          >
            Settings
          </Button>
        </div>
        <UsagePane withSectionIds={false} />
      </PopoverContent>
    </Popover>
  )
}

export default UsagePopover
