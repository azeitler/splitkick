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
  Search,
  type LucideIcon,
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

const paneIconMap: Record<PreferencePane, LucideIcon> = {
  general: Settings,
  providers: Blocks,
  usage: BarChart3,
  appearance: Palette,
  keybindings: Keyboard,
  'magic-prompts': Wand2,
  'mcp-servers': Plug,
  integrations: Puzzle,
  experimental: FlaskConical,
  'web-access': Globe,
}

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

/** Group search results by pane, preserving Fuse.js ranking order within each group. */
function groupResultsByPane(results: PreferenceSearchEntry[]) {
  const groups: {
    pane: PreferencePane
    title: string
    items: PreferenceSearchEntry[]
  }[] = []
  const seen = new Set<PreferencePane>()

  for (const result of results) {
    if (!seen.has(result.pane)) {
      seen.add(result.pane)
      groups.push({ pane: result.pane, title: result.paneTitle, items: [] })
    }
    const group = groups.find(g => g.pane === result.pane)
    if (group) group.items.push(result)
  }

  return groups
}

export function PreferencesDialog() {
  const [activePane, setActivePane] = useState<PreferencePane>('general')
  const [searchValue, setSearchValue] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
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
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const mobileSearchContainerRef = useRef<HTMLDivElement>(null)

  const searchResults = useMemo(
    () => searchPreferenceEntries(searchValue, 30),
    [searchValue]
  )
  const groupedResults = useMemo(
    () => groupResultsByPane(searchResults),
    [searchResults]
  )
  const isSearching = searchValue.trim().length > 0

  // Handle open state change and navigate to specific pane if requested
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setActivePane('general')
        setSearchValue('')
        setSearchOpen(false)
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

  // Scroll-to and highlight on pending jump
  useEffect(() => {
    if (!pendingJump) return
    if (pendingJump.pane !== activePane) return

    const raf = window.requestAnimationFrame(() => {
      const anchorId = pendingJump.anchorId ?? pendingJump.fallbackAnchorId
      if (!anchorId) return

      const target = document.getElementById(anchorId)
      if (!target) return

      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('settings-search-highlight')
      const onEnd = () => {
        target.classList.remove('settings-search-highlight')
        target.removeEventListener('animationend', onEnd)
      }
      target.addEventListener('animationend', onEnd)
    })
    setPendingJump(null)
    return () => window.cancelAnimationFrame(raf)
  }, [activePane, pendingJump])

  // Close search dropdown on click outside
  useEffect(() => {
    if (!searchOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      const inDesktop = searchContainerRef.current?.contains(target) ?? false
      const inMobile =
        mobileSearchContainerRef.current?.contains(target) ?? false
      if (!inDesktop && !inMobile) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [searchOpen])

  // "/" keyboard shortcut to focus search when dialog is open
  useEffect(() => {
    if (!preferencesOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [preferencesOpen])

  const handlePaneSelect = useCallback((pane: PreferencePane) => {
    setSearchValue('')
    setSearchOpen(false)
    setPendingJump(null)
    setSearchTargetAction(null)
    setSearchTargetPromptKey(null)
    setActivePane(pane)
  }, [])

  const handleSearchResultSelect = useCallback(
    (entry: PreferenceSearchEntry) => {
      setActivePane(entry.pane)
      setSearchValue('')
      setSearchOpen(false)
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
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border">
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

                {/* Search bar — right side of header */}
                <div
                  ref={searchContainerRef}
                  className="relative hidden md:block ml-auto"
                >
                  <Command
                    shouldFilter={false}
                    className="bg-transparent overflow-visible"
                  >
                    <div className="flex h-8 w-52 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-colors">
                      <Search className="size-3.5 shrink-0 text-muted-foreground" />
                      <input
                        ref={searchInputRef}
                        placeholder="Search settings..."
                        value={searchValue}
                        onChange={e => {
                          setSearchValue(e.target.value)
                          setSearchOpen(true)
                        }}
                        onFocus={() => {
                          if (searchValue.trim()) setSearchOpen(true)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Escape') {
                            setSearchValue('')
                            setSearchOpen(false)
                            searchInputRef.current?.blur()
                          }
                          // Let cmdk handle ArrowDown/Up/Enter when dropdown is open
                          if (
                            searchOpen &&
                            isSearching &&
                            (e.key === 'ArrowDown' ||
                              e.key === 'ArrowUp' ||
                              e.key === 'Enter')
                          ) {
                            // Don't prevent — cmdk will handle via its Command wrapper
                          }
                        }}
                        className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm"
                      />
                      {!searchValue && (
                        <kbd className="pointer-events-none text-[10px] font-mono text-muted-foreground/60">
                          /
                        </kbd>
                      )}
                    </div>

                    {/* Results dropdown */}
                    {searchOpen && isSearching && (
                      <CommandList className="absolute top-full right-0 mt-1.5 w-80 max-h-[360px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg z-50">
                        {searchResults.length === 0 ? (
                          <CommandEmpty>No settings found.</CommandEmpty>
                        ) : (
                          groupedResults.map(group => {
                            const Icon = paneIconMap[group.pane]
                            return (
                              <CommandGroup
                                key={group.pane}
                                heading={
                                  <span className="flex items-center gap-1.5">
                                    <Icon className="size-3" />
                                    {group.title}
                                  </span>
                                }
                              >
                                {group.items.map(result => (
                                  <CommandItem
                                    key={result.id}
                                    value={result.id}
                                    onSelect={() =>
                                      handleSearchResultSelect(result)
                                    }
                                  >
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                      <span className="truncate text-sm">
                                        {result.title}
                                      </span>
                                      {result.sectionTitle &&
                                        result.sectionTitle !==
                                          result.paneTitle && (
                                          <span className="text-xs text-muted-foreground truncate">
                                            {result.sectionTitle}
                                          </span>
                                        )}
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )
                          })
                        )}
                      </CommandList>
                    )}
                  </Command>
                </div>

                <ModalCloseButton
                  className="hidden md:inline-flex shrink-0"
                  onClick={() => handleOpenChange(false)}
                />
              </div>
            </header>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 min-h-0 custom-scrollbar">
              {/* Mobile search bar */}
              <div
                ref={mobileSearchContainerRef}
                className="relative md:hidden"
              >
                <Command
                  shouldFilter={false}
                  className="bg-transparent overflow-visible"
                >
                  <div className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-colors">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <input
                      placeholder="Search settings..."
                      value={searchValue}
                      onChange={e => {
                        setSearchValue(e.target.value)
                        setSearchOpen(true)
                      }}
                      onFocus={() => {
                        if (searchValue.trim()) setSearchOpen(true)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Escape') {
                          setSearchValue('')
                          setSearchOpen(false)
                        }
                      }}
                      className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm"
                    />
                  </div>

                  {searchOpen && isSearching && (
                    <CommandList className="absolute top-full left-0 right-0 mt-1.5 max-h-[320px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg z-50">
                      {searchResults.length === 0 ? (
                        <CommandEmpty>No settings found.</CommandEmpty>
                      ) : (
                        groupedResults.map(group => {
                          const Icon = paneIconMap[group.pane]
                          return (
                            <CommandGroup
                              key={group.pane}
                              heading={
                                <span className="flex items-center gap-1.5">
                                  <Icon className="size-3" />
                                  {group.title}
                                </span>
                              }
                            >
                              {group.items.map(result => (
                                <CommandItem
                                  key={result.id}
                                  value={result.id}
                                  onSelect={() =>
                                    handleSearchResultSelect(result)
                                  }
                                >
                                  <span className="truncate text-sm">
                                    {result.title}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )
                        })
                      )}
                    </CommandList>
                  )}
                </Command>
              </div>

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
                  <KeybindingsPane searchTargetAction={searchTargetAction} />
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
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

export default PreferencesDialog
