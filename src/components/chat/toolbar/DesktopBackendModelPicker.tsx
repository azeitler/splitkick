import { ChevronsUpDown } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
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
import type { CustomCliProfile } from '@/types/preferences'
import { BACKEND_LABELS } from '@/services/mcp'
import { useAvailableOpencodeModels } from '@/services/opencode-cli'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { BackendModelPickerContent } from '@/components/chat/toolbar/BackendModelPickerContent'
import { formatOpencodeModelLabel } from '@/components/chat/toolbar/toolbar-utils'
import { useToolbarDerivedState } from '@/components/chat/toolbar/useToolbarDerivedState'
import { useToolbarDropdownShortcuts } from '@/components/chat/toolbar/useToolbarDropdownShortcuts'
import { useIsMobile } from '@/hooks/use-mobile'

interface DesktopBackendModelPickerProps {
  disabled?: boolean
  sessionHasMessages?: boolean
  providerLocked?: boolean
  triggerClassName?: string
  selectedBackend: 'claude' | 'codex' | 'opencode'
  selectedModel: string
  selectedProvider: string | null
  installedBackends: ('claude' | 'codex' | 'opencode')[]
  customCliProfiles: CustomCliProfile[]
  onModelChange: (model: string) => void
  onBackendModelChange: (
    backend: 'claude' | 'codex' | 'opencode',
    model: string
  ) => void
}

export function DesktopBackendModelPicker({
  disabled = false,
  sessionHasMessages,
  providerLocked,
  triggerClassName,
  selectedBackend,
  selectedModel,
  selectedProvider,
  installedBackends,
  customCliProfiles,
  onModelChange,
  onBackendModelChange,
}: DesktopBackendModelPickerProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  useToolbarDropdownShortcuts({
    setModelDropdownOpen: setOpen,
    enabled: !isMobile,
  })

  const { data: availableOpencodeModels } = useAvailableOpencodeModels({
    enabled: installedBackends.includes('opencode'),
  })

  const opencodeModelOptions = useMemo(
    () =>
      availableOpencodeModels?.map(model => ({
        value: model,
        label: formatOpencodeModelLabel(model),
      })),
    [availableOpencodeModels]
  )

  const { selectedModelLabel } = useToolbarDerivedState({
    selectedBackend,
    selectedProvider,
    selectedModel,
    opencodeModelOptions,
    customCliProfiles,
    installedBackends,
  })

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      window.dispatchEvent(new CustomEvent('focus-chat-input'))
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Choose backend and model"
              className={cn(
                'hidden @xl:flex h-8 max-w-[22rem] shrink-0 items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                triggerClassName
              )}
            >
              <span className="truncate">
                {BACKEND_LABELS[selectedBackend] ?? selectedBackend} ·{' '}
                {selectedModelLabel}
              </span>
              {!sessionHasMessages && installedBackends.length > 1 && (
                <Kbd className="ml-1 hidden 2xl:inline-flex text-[10px]">
                  Tab
                </Kbd>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {sessionHasMessages
            ? 'Model (⌘⇧M)'
            : 'Backend + model (⌘⇧M) · Tab cycles backend'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-[min(36rem,calc(100vw-4rem))] p-0"
      >
        <BackendModelPickerContent
          open={open}
          selectedBackend={selectedBackend}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          installedBackends={installedBackends}
          customCliProfiles={customCliProfiles}
          sessionHasMessages={sessionHasMessages}
          providerLocked={providerLocked}
          onModelChange={onModelChange}
          onBackendModelChange={onBackendModelChange}
          onRequestClose={() => handleOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
