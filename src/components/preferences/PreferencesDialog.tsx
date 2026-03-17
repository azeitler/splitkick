import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Settings,
  Palette,
  Keyboard,
  Wand2,
  Plug,
  Blocks,
  BarChart3,
  Puzzle,
  FlaskConical,
  Globe,
} from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { ModalCloseButton } from '@/components/ui/modal-close-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { useUIStore, type PreferencePane } from '@/store/ui-store'
import type { KeybindingAction } from '@/types/keybindings'
import type { MagicPrompts } from '@/types/preferences'
import { GeneralPane } from './panes/GeneralPane'
import { AppearancePane } from './panes/AppearancePane'
import { KeybindingsPane } from './panes/KeybindingsPane'
import { MagicPromptsPane } from './panes/MagicPromptsPane'
import { McpServersPane } from './panes/McpServersPane'
import { ProvidersPane } from './panes/ProvidersPane'
import { UsagePane } from './panes/UsagePane'
import { IntegrationsPane } from './panes/IntegrationsPane'
import { ExperimentalPane } from './panes/ExperimentalPane'
import { WebAccessPane } from './panes/WebAccessPane'
import {
  searchPreferenceEntries,
  type PreferenceSearchEntry,
} from './preferences-search'

const navigationItems = [
  {
    id: 'general' as const,
    name: 'General',
    icon: Settings,
  },
  {
    id: 'providers' as const,
    name: 'Providers',
    icon: Blocks,
  },
  {
    id: 'usage' as const,
    name: 'Usage',
    icon: BarChart3,
  },
  {
    id: 'appearance' as const,
    name: 'Appearance',
    icon: Palette,
  },
  {
    id: 'keybindings' as const,
    name: 'Keybindings',
    icon: Keyboard,
    desktopOnly: true,
  },
  {
    id: 'magic-prompts' as const,
    name: 'Magic Prompts',
    icon: Wand2,
  },
  {
    id: 'mcp-servers' as const,
    name: 'MCP Servers',
    icon: Plug,
  },
  {
    id: 'integrations' as const,
    name: 'Integrations',
    icon: Puzzle,
  },
  {
    id: 'experimental' as const,
    name: 'Experimental',
    icon: FlaskConical,
  },
  {
    id: 'web-access' as const,
    name: 'Web Access (Experimental)',
    icon: Globe,
    desktopOnly: true,
  },
]

const getPaneTitle = (pane: PreferencePane): string => {
  switch (pane) {
    case 'general':
      return 'General'
    case 'appearance':
      return 'Appearance'
    case 'keybindings':
      return 'Keybindings'
    case 'magic-prompts':
      return 'Magic Prompts'
    case 'mcp-servers':
      return 'MCP Servers'
    case 'providers':
      return 'Providers'
    case 'usage':
      return 'Usage'
    case 'integrations':
      return 'Integrations'
    case 'experimental':
      return 'Experimental'
    case 'web-access':
      return 'Web Access (Experimental)'
    default:
      return 'General'
  }
}

export function PreferencesDialog() {
  const [activePane, setActivePane] = useState<PreferencePane>('general')
  const [searchValue, setSearchValue] = useState('')
  const [pendingJump, setPendingJump] = useState<PreferenceSearchEntry | null>(
    null
  )
  const [searchTargetAction, setSearchTargetAction] =
    useState<KeybindingAction | null>(null)
  const [searchTargetPromptKey, setSearchTargetPromptKey] = useState<
    keyof MagicPrompts | null
  >(null)
  const preferencesOpen = useUIStore(state => state.preferencesOpen)
  const setPreferencesOpen = useUIStore(state => state.setPreferencesOpen)
  const preferencesPane = useUIStore(state => state.preferencesPane)
  const clearHighlightTimeoutRef = useRef<number | null>(null)

  const searchResults = useMemo(
    () => searchPreferenceEntries(searchValue, 40),
    [searchValue]
  )
  const isSearching = searchValue.trim().length > 0

  const clearPendingHighlight = useCallback(() => {
    if (clearHighlightTimeoutRef.current) {
      window.clearTimeout(clearHighlightTimeoutRef.current)
      clearHighlightTimeoutRef.current = null
    }
  }, [])

  // Handle open state change and navigate to specific pane if requested
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setActivePane('general')
        setSearchValue('')
        setPendingJump(null)
        setSearchTargetAction(null)
        setSearchTargetPromptKey(null)
      }
      setPreferencesOpen(open)
    },
    [setPreferencesOpen]
  )

  // Sync activePane from preferencesPane when dialog opens to a specific pane
  useEffect(() => {
    if (preferencesOpen && preferencesPane) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActivePane(preferencesPane)
    }
  }, [preferencesOpen, preferencesPane])

  useEffect(() => {
    if (!pendingJump) return
    if (pendingJump.pane !== activePane) return

    const scrollAndHighlight = () => {
      const anchorId = pendingJump.anchorId ?? pendingJump.fallbackAnchorId
      if (!anchorId) return

      const target = document.getElementById(anchorId)
      if (!target) return

      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add(
        'ring-2',
        'ring-primary/40',
        'ring-offset-2',
        'ring-offset-background',
        'rounded-md'
      )

      clearPendingHighlight()
      clearHighlightTimeoutRef.current = window.setTimeout(() => {
        target.classList.remove(
          'ring-2',
          'ring-primary/40',
          'ring-offset-2',
          'ring-offset-background',
          'rounded-md'
        )
      }, 1800)
    }

    const raf = window.requestAnimationFrame(scrollAndHighlight)
    setPendingJump(null)
    return () => window.cancelAnimationFrame(raf)
  }, [activePane, clearPendingHighlight, pendingJump])

  useEffect(() => () => clearPendingHighlight(), [clearPendingHighlight])

  const handlePaneSelect = useCallback((pane: PreferencePane) => {
    setSearchValue('')
    setPendingJump(null)
    setSearchTargetAction(null)
    setSearchTargetPromptKey(null)
    setActivePane(pane)
  }, [])

  const handleSearchResultSelect = useCallback(
    (entry: PreferenceSearchEntry) => {
      setActivePane(entry.pane)
      setSearchValue('')
      setPendingJump(entry)
      setSearchTargetAction(entry.keybindingAction ?? null)
      setSearchTargetPromptKey(entry.detailKey ?? null)
    },
    []
  )

  return (
    <Dialog open={preferencesOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden p-0 !w-screen !h-dvh !max-w-screen !max-h-none !rounded-none sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!h-[85vh] sm:!rounded-xl font-sans"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your application preferences here.
        </DialogDescription>

        <SidebarProvider className="!min-h-0 !h-full items-stretch overflow-hidden">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navigationItems.map(item => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={activePane === item.id}
                        >
                          <button
                            onClick={() => handlePaneSelect(item.id)}
                            className="w-full"
                          >
                            <item.icon />
                            <span>{item.name}</span>
                          </button>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          <main className="flex flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2">
              <div className="flex flex-1 items-center gap-2 px-4">
                {/* Mobile pane selector */}
                <Select
                  value={activePane}
                  onValueChange={v => handlePaneSelect(v as PreferencePane)}
                >
                  <SelectTrigger className="md:hidden w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {navigationItems
                      .filter(item => !item.desktopOnly)
                      .map(item => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <ModalCloseButton
                  size="lg"
                  className="md:hidden"
                  onClick={() => handleOpenChange(false)}
                />
                <Breadcrumb className="hidden md:block">
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>
                        {getPaneTitle(activePane)}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <ModalCloseButton
                  className="hidden md:inline-flex ml-auto"
                  onClick={() => handleOpenChange(false)}
                />
              </div>
            </header>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0 min-h-0 custom-scrollbar">
              <Command
                shouldFilter={false}
                className="rounded-lg border border-border bg-background"
              >
                <CommandInput
                  placeholder="Search settings..."
                  value={searchValue}
                  onValueChange={setSearchValue}
                />
                {isSearching && (
                  <CommandList className="max-h-[320px]">
                    <CommandEmpty>No settings found.</CommandEmpty>
                    <CommandGroup heading="Results">
                      {searchResults.map(result => (
                        <CommandItem
                          key={result.id}
                          value={`${result.title} ${result.paneTitle} ${result.sectionTitle ?? ''} ${result.keywords.join(' ')}`}
                          onSelect={() => handleSearchResultSelect(result)}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate">{result.title}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {result.sectionTitle
                                ? `${result.paneTitle} / ${result.sectionTitle}`
                                : result.paneTitle}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                )}
              </Command>

              {!isSearching && (
                <>
                  {activePane === 'general' && (
                    <div id="pref-pane-general">
                      <GeneralPane />
                    </div>
                  )}
                  {activePane === 'appearance' && (
                    <div id="pref-pane-appearance">
                      <AppearancePane />
                    </div>
                  )}
                  {activePane === 'keybindings' && (
                    <div id="pref-pane-keybindings">
                      <KeybindingsPane
                        searchTargetAction={searchTargetAction}
                      />
                    </div>
                  )}
                  {activePane === 'magic-prompts' && (
                    <div id="pref-pane-magic-prompts">
                      <MagicPromptsPane
                        searchTargetPromptKey={searchTargetPromptKey}
                      />
                    </div>
                  )}
                  {activePane === 'mcp-servers' && (
                    <div id="pref-pane-mcp-servers">
                      <McpServersPane />
                    </div>
                  )}
                  {activePane === 'providers' && (
                    <div id="pref-pane-providers">
                      <ProvidersPane />
                    </div>
                  )}
                  {activePane === 'usage' && (
                    <div id="pref-pane-usage">
                      <UsagePane />
                    </div>
                  )}
                  {activePane === 'integrations' && (
                    <div id="pref-pane-integrations">
                      <IntegrationsPane />
                    </div>
                  )}
                  {activePane === 'experimental' && (
                    <div id="pref-pane-experimental">
                      <ExperimentalPane />
                    </div>
                  )}
                  {activePane === 'web-access' && (
                    <div id="pref-pane-web-access">
                      <WebAccessPane />
                    </div>
                  )}
                </>
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

export default PreferencesDialog
