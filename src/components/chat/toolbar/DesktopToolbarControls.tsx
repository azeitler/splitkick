import {
  Brain,
  ChevronDown,
  CircleDot,
  ClipboardList,
  ExternalLink,
  FolderOpen,
  GitMerge,
  GitPullRequest,
  Hammer,
  Loader2,
  Plug,
  Sparkles,
  Wand2,
  Zap,
} from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { CustomCliProfile } from '@/types/preferences'
import type {
  EffortLevel,
  ExecutionMode,
  McpHealthStatus,
  ThinkingLevel,
} from '@/types/chat'
import type {
  AttachedSavedContext,
  LoadedIssueContext,
  LoadedPullRequestContext,
} from '@/types/github'
import type { CheckStatus, MergeableStatus, PrDisplayStatus } from '@/types/pr-status'
import { openExternal } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { CheckStatusButton } from '@/components/chat/toolbar/CheckStatusButton'
import { McpStatusDot, mcpStatusHint } from '@/components/chat/toolbar/McpStatusDot'
import {
  EFFORT_LEVEL_OPTIONS,
  THINKING_LEVEL_OPTIONS,
} from '@/components/chat/toolbar/toolbar-options'
import {
  getPrStatusDisplay,
  getProviderDisplayName,
} from '@/components/chat/toolbar/toolbar-utils'

interface DesktopToolbarControlsProps {
  hasPendingQuestions: boolean
  selectedBackend: 'claude' | 'codex'
  selectedModel: string
  selectedProvider: string | null
  selectedThinkingLevel: ThinkingLevel
  selectedEffortLevel: EffortLevel
  executionMode: ExecutionMode
  useAdaptiveThinking: boolean
  hideThinkingLevel?: boolean
  sessionHasMessages?: boolean
  providerLocked?: boolean
  customCliProfiles: CustomCliProfile[]
  filteredModelOptions: { value: string; label: string }[]
  selectedModelLabel: string
  isCodex: boolean

  prUrl: string | undefined
  prNumber: number | undefined
  displayStatus: PrDisplayStatus | undefined
  checkStatus: CheckStatus | undefined
  mergeableStatus: MergeableStatus | undefined
  activeWorktreePath: string | undefined

  availableMcpServers: { name: string; disabled?: boolean; scope: string }[]
  enabledMcpServers: string[]
  activeMcpCount: number
  isHealthChecking: boolean
  mcpStatuses: Record<string, McpHealthStatus> | undefined

  loadedIssueContexts: LoadedIssueContext[]
  loadedPRContexts: LoadedPullRequestContext[]
  attachedSavedContexts: AttachedSavedContext[]

  providerDropdownOpen: boolean
  modelDropdownOpen: boolean
  thinkingDropdownOpen: boolean
  mcpDropdownOpen: boolean
  setProviderDropdownOpen: (open: boolean) => void
  setModelDropdownOpen: (open: boolean) => void
  setThinkingDropdownOpen: (open: boolean) => void
  onMcpDropdownOpenChange: (open: boolean) => void

  onOpenMagicModal: () => void
  onOpenProjectSettings?: () => void
  onResolvePrConflicts: () => void
  onLoadContext: () => void
  onBackendChange: (backend: 'claude' | 'codex') => void
  onSetExecutionMode: (mode: ExecutionMode) => void
  onToggleMcpServer: (name: string) => void

  handleModelChange: (value: string) => void
  handleProviderChange: (value: string) => void
  handleThinkingLevelChange: (value: string) => void
  handleEffortLevelChange: (value: string) => void
  handleViewIssue: (ctx: LoadedIssueContext) => void
  handleViewPR: (ctx: LoadedPullRequestContext) => void
  handleViewSavedContext: (ctx: AttachedSavedContext) => void
}

export function DesktopToolbarControls({
  hasPendingQuestions,
  selectedBackend,
  selectedModel,
  selectedProvider,
  selectedThinkingLevel,
  selectedEffortLevel,
  executionMode,
  useAdaptiveThinking,
  hideThinkingLevel,
  sessionHasMessages,
  providerLocked,
  customCliProfiles,
  filteredModelOptions,
  selectedModelLabel,
  isCodex,
  prUrl,
  prNumber,
  displayStatus,
  checkStatus,
  mergeableStatus,
  activeWorktreePath,
  availableMcpServers,
  enabledMcpServers,
  activeMcpCount,
  isHealthChecking,
  mcpStatuses,
  loadedIssueContexts,
  loadedPRContexts,
  attachedSavedContexts,
  providerDropdownOpen,
  modelDropdownOpen,
  thinkingDropdownOpen,
  mcpDropdownOpen,
  setProviderDropdownOpen,
  setModelDropdownOpen,
  setThinkingDropdownOpen,
  onMcpDropdownOpenChange,
  onOpenMagicModal,
  onOpenProjectSettings,
  onResolvePrConflicts,
  onLoadContext,
  onBackendChange,
  onSetExecutionMode,
  onToggleMcpServer,
  handleModelChange,
  handleProviderChange,
  handleThinkingLevelChange,
  handleEffortLevelChange,
  handleViewIssue,
  handleViewPR,
  handleViewSavedContext,
}: DesktopToolbarControlsProps) {
  const loadedIssueCount = loadedIssueContexts.length
  const loadedPRCount = loadedPRContexts.length
  const loadedContextCount = attachedSavedContexts.length
  const providerDisplayName = getProviderDisplayName(selectedProvider)

  return (
    <>
      <div className="block @xl:hidden h-4 w-px bg-border/50" />

      <button
        type="button"
        className="hidden @xl:flex h-8 items-center gap-1 rounded-l-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={hasPendingQuestions}
        onClick={onOpenMagicModal}
      >
        <Wand2 className="h-3.5 w-3.5" />
      </button>

      <div className="hidden @xl:block h-4 w-px bg-border/50" />

      <DropdownMenu open={mcpDropdownOpen} onOpenChange={onMcpDropdownOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={hasPendingQuestions}
                className="hidden @xl:flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <Plug
                  className={cn(
                    'h-3.5 w-3.5',
                    activeMcpCount > 0 && 'text-emerald-600 dark:text-emerald-400'
                  )}
                />
                {activeMcpCount > 0 && <span>{activeMcpCount}</span>}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {activeMcpCount > 0
              ? `${activeMcpCount} MCP server(s) enabled`
              : 'No MCP servers enabled'}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="flex items-center gap-2">
            MCP Servers
            {isHealthChecking && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {availableMcpServers.length > 0 ? (
            availableMcpServers.map(server => {
              const status = mcpStatuses?.[server.name]
              const hint = mcpStatusHint(status)
              const item = (
                <DropdownMenuCheckboxItem
                  key={server.name}
                  checked={!server.disabled && enabledMcpServers.includes(server.name)}
                  onCheckedChange={() => onToggleMcpServer(server.name)}
                  disabled={server.disabled}
                  className={server.disabled ? 'opacity-50' : undefined}
                >
                  <span className="flex items-center gap-1.5">
                    <McpStatusDot status={status} />
                    {server.name}
                  </span>
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">
                    {server.disabled ? 'disabled' : server.scope}
                  </span>
                </DropdownMenuCheckboxItem>
              )
              if (!hint) return item
              return (
                <Tooltip key={server.name}>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent side="left">{hint}</TooltipContent>
                </Tooltip>
              )
            })
          ) : (
            <DropdownMenuItem disabled>
              <span className="text-xs text-muted-foreground">
                No MCP servers configured
              </span>
            </DropdownMenuItem>
          )}
          {onOpenProjectSettings && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenProjectSettings}>
                <span className="text-xs text-muted-foreground">
                  Set defaults in project settings
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {(loadedIssueCount > 0 || loadedPRCount > 0 || loadedContextCount > 0) && (
        <>
          <div className="hidden @xl:block h-4 w-px bg-border/50" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hidden @xl:flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              >
                <CircleDot className="h-3.5 w-3.5" />
                <span>
                  {loadedIssueCount > 0 &&
                    `${loadedIssueCount} Issue${loadedIssueCount > 1 ? 's' : ''}`}
                  {loadedIssueCount > 0 &&
                    (loadedPRCount > 0 || loadedContextCount > 0) &&
                    ', '}
                  {loadedPRCount > 0 &&
                    `${loadedPRCount} PR${loadedPRCount > 1 ? 's' : ''}`}
                  {loadedPRCount > 0 && loadedContextCount > 0 && ', '}
                  {loadedContextCount > 0 &&
                    `${loadedContextCount} Context${loadedContextCount > 1 ? 's' : ''}`}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {loadedIssueContexts.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Issues
                  </DropdownMenuLabel>
                  {loadedIssueContexts.map(ctx => (
                    <DropdownMenuItem
                      key={ctx.number}
                      onClick={() => handleViewIssue(ctx)}
                    >
                      <CircleDot className="h-4 w-4 text-green-500" />
                      <span className="truncate">
                        #{ctx.number} {ctx.title}
                      </span>
                      <button
                        className="ml-auto shrink-0 rounded p-0.5 hover:bg-accent"
                        onClick={e => {
                          e.stopPropagation()
                          openExternal(
                            `https://github.com/${ctx.repoOwner}/${ctx.repoName}/issues/${ctx.number}`
                          )
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {loadedPRContexts.length > 0 && (
                <>
                  {loadedIssueContexts.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Pull Requests
                  </DropdownMenuLabel>
                  {loadedPRContexts.map(ctx => (
                    <DropdownMenuItem
                      key={ctx.number}
                      onClick={() => handleViewPR(ctx)}
                    >
                      <GitPullRequest className="h-4 w-4 text-green-500" />
                      <span className="truncate">
                        #{ctx.number} {ctx.title}
                      </span>
                      <button
                        className="ml-auto shrink-0 rounded p-0.5 hover:bg-accent"
                        onClick={e => {
                          e.stopPropagation()
                          openExternal(
                            `https://github.com/${ctx.repoOwner}/${ctx.repoName}/pull/${ctx.number}`
                          )
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {attachedSavedContexts.length > 0 && (
                <>
                  {(loadedIssueContexts.length > 0 ||
                    loadedPRContexts.length > 0) && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Contexts
                  </DropdownMenuLabel>
                  {attachedSavedContexts.map(ctx => (
                    <DropdownMenuItem
                      key={ctx.slug}
                      onClick={() => handleViewSavedContext(ctx)}
                    >
                      <FolderOpen className="h-4 w-4 text-blue-500" />
                      <span className="truncate">{ctx.name || ctx.slug}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLoadContext}>
                <FolderOpen className="h-4 w-4" />
                Manage Contexts...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {prUrl && prNumber && (
        <>
          <div className="hidden @xl:block h-4 w-px bg-border/50" />
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'hidden @xl:flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors select-none hover:bg-muted/80 hover:text-foreground',
                  displayStatus
                    ? getPrStatusDisplay(displayStatus).className
                    : 'text-muted-foreground'
                )}
              >
                {displayStatus === 'merged' ? (
                  <GitMerge className="h-3.5 w-3.5" />
                ) : (
                  <GitPullRequest className="h-3.5 w-3.5" />
                )}
                <span>#{prNumber}</span>
                <CheckStatusButton
                  status={checkStatus ?? null}
                  projectPath={activeWorktreePath}
                />
              </a>
            </TooltipTrigger>
            <TooltipContent>
              {displayStatus
                ? `${getPrStatusDisplay(displayStatus).label} · PR #${prNumber} on GitHub`
                : `PR #${prNumber} on GitHub`}
            </TooltipContent>
          </Tooltip>
        </>
      )}

      {mergeableStatus === 'conflicting' && (
        <>
          <div className="hidden @xl:block h-4 w-px bg-border/50" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="hidden @xl:flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-amber-600 dark:text-amber-400 transition-colors cursor-pointer hover:bg-muted/80"
                onClick={onResolvePrConflicts}
              >
                <GitMerge className="h-3 w-3" />
                <span>Conflicts</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>PR has merge conflicts — click to resolve</TooltipContent>
          </Tooltip>
        </>
      )}

      {!sessionHasMessages && (
        <>
          <div className="hidden @xl:block h-4 w-px bg-border/50" />
          <div className="hidden @xl:flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onBackendChange('claude')}
                  className={cn(
                    'h-7 rounded px-2.5 text-xs font-medium transition-colors',
                    selectedBackend === 'claude'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Claude
                </button>
              </TooltipTrigger>
              <TooltipContent>Switch backend (Tab)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onBackendChange('codex')}
                  className={cn(
                    'h-7 rounded px-2.5 text-xs font-medium transition-colors',
                    selectedBackend === 'codex'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Codex
                  <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                    BETA
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Switch backend (Tab)</TooltipContent>
            </Tooltip>
          </div>
        </>
      )}

      {customCliProfiles.length > 0 && !providerLocked && !isCodex && (
        <>
          <div className="hidden @xl:block h-4 w-px bg-border/50" />
          <DropdownMenu
            open={providerDropdownOpen}
            onOpenChange={setProviderDropdownOpen}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={hasPendingQuestions}
                    className="hidden @xl:flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span>{providerDisplayName}</span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Provider (⌥P)</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuRadioGroup
                value={selectedProvider ?? '__anthropic__'}
                onValueChange={handleProviderChange}
              >
                <DropdownMenuRadioItem value="__anthropic__">
                  Anthropic
                  <Kbd className="ml-auto text-[10px]">1</Kbd>
                </DropdownMenuRadioItem>
                {customCliProfiles.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1.5">
                      Custom Providers
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium leading-none">
                        cc
                      </span>
                    </DropdownMenuLabel>
                    {customCliProfiles.map((profile, i) => (
                      <DropdownMenuRadioItem key={profile.name} value={profile.name}>
                        {profile.name}
                        <Kbd className="ml-auto text-[10px]">{i + 2}</Kbd>
                      </DropdownMenuRadioItem>
                    ))}
                  </>
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <div className="hidden @xl:block h-4 w-px bg-border/50" />

      <DropdownMenu open={modelDropdownOpen} onOpenChange={setModelDropdownOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={hasPendingQuestions}
                className="hidden @xl:flex h-8 items-center gap-1.5 rounded-none bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{selectedModelLabel}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Model (⌥M)</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="min-w-40">
          {providerLocked && customCliProfiles.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Provider: {providerDisplayName}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuRadioGroup value={selectedModel} onValueChange={handleModelChange}>
            {filteredModelOptions.map((option, i) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
                <Kbd className="ml-auto text-[10px]">{i + 1}</Kbd>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {!hideThinkingLevel && <div className="hidden @xl:block h-4 w-px bg-border/50" />}

      {hideThinkingLevel ? null : useAdaptiveThinking || isCodex ? (
        <DropdownMenu
          open={thinkingDropdownOpen}
          onOpenChange={setThinkingDropdownOpen}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={hasPendingQuestions}
                  className="hidden @xl:flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <Brain className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                  <span>
                    {EFFORT_LEVEL_OPTIONS.find(o => o.value === selectedEffortLevel)?.label}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {`Effort: ${EFFORT_LEVEL_OPTIONS.find(o => o.value === selectedEffortLevel)?.label} (⌥E)`}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={selectedEffortLevel}
              onValueChange={handleEffortLevelChange}
            >
              {EFFORT_LEVEL_OPTIONS.map((option, i) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <Brain className="mr-2 h-4 w-4" />
                  {option.label}
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">
                    {option.description}
                  </span>
                  <Kbd className="ml-2 text-[10px]">{i + 1}</Kbd>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <DropdownMenu
          open={thinkingDropdownOpen}
          onOpenChange={setThinkingDropdownOpen}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={hasPendingQuestions}
                  className="hidden @xl:flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <Brain
                    className={cn(
                      'h-3.5 w-3.5',
                      selectedThinkingLevel !== 'off' &&
                        'text-purple-600 dark:text-purple-400'
                    )}
                  />
                  <span>
                    {THINKING_LEVEL_OPTIONS.find(o => o.value === selectedThinkingLevel)?.label}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {`Thinking: ${THINKING_LEVEL_OPTIONS.find(o => o.value === selectedThinkingLevel)?.label} (⌥E)`}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={selectedThinkingLevel}
              onValueChange={handleThinkingLevelChange}
            >
              {THINKING_LEVEL_OPTIONS.map((option, i) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <Brain className="mr-2 h-4 w-4" />
                  {option.label}
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">
                    {option.tokens}
                  </span>
                  <Kbd className="ml-2 text-[10px]">{i + 1}</Kbd>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="hidden @xl:block h-4 w-px bg-border/50" />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={hasPendingQuestions}
                className="hidden @xl:flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {executionMode === 'plan' && (
                  <ClipboardList className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                )}
                {executionMode === 'build' && <Hammer className="h-3.5 w-3.5" />}
                {executionMode === 'yolo' && (
                  <Zap className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
                )}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {`${executionMode.charAt(0).toUpperCase() + executionMode.slice(1)} mode (Shift+Tab to cycle)`}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={executionMode}
            onValueChange={v => onSetExecutionMode(v as ExecutionMode)}
          >
            <DropdownMenuRadioItem value="plan">
              <ClipboardList className="mr-2 h-4 w-4" />
              Plan
              <span className="ml-auto pl-4 text-xs text-muted-foreground">Read-only</span>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="build">
              <Hammer className="mr-2 h-4 w-4" />
              Build
              <span className="ml-auto pl-4 text-xs text-muted-foreground">Auto-edits</span>
            </DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem
              value="yolo"
              className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
            >
              <Zap className="mr-2 h-4 w-4" />
              Yolo
              <span className="ml-auto pl-4 text-xs">No limits!</span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
