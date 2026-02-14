import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { getModifierSymbol, isMacOS } from '@/lib/platform'
import { toast } from 'sonner'
import {
  gitPush,
  triggerImmediateGitPoll,
  fetchWorktreesStatus,
  performGitPull,
} from '@/services/git-status'
import { useChatStore } from '@/store/chat-store'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BookmarkPlus,
  Brain,
  CheckCircle,
  ChevronDown,
  CircleDot,
  ClipboardList,
  ExternalLink,
  Eye,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Hammer,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plug,
  Send,
  ShieldAlert,
  Sparkles,
  Wand2,
  XCircle,
  Zap,
} from 'lucide-react'
import { openExternal } from '@/lib/platform'
import { Kbd } from '@/components/ui/kbd'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'
import type { ClaudeModel } from '@/store/chat-store'
import type { CustomCliProfile } from '@/types/preferences'
import { useMcpHealthCheck } from '@/services/mcp'
import type { McpServerInfo, McpHealthStatus } from '@/types/chat'
import type { ThinkingLevel, EffortLevel, ExecutionMode } from '@/types/chat'
import type {
  PrDisplayStatus,
  CheckStatus,
  MergeableStatus,
} from '@/types/pr-status'
import type { DiffRequest } from '@/types/git-diff'
import type {
  LoadedIssueContext,
  LoadedPullRequestContext,
  AttachedSavedContext,
} from '@/types/github'
import {
  getIssueContextContent,
  getPRContextContent,
  getSavedContextContent,
} from '@/services/github'

/** Model options with display labels */
export const MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'opus-4.5', label: 'Opus 4.5' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]

/** Thinking level options with display labels and token counts */
export const THINKING_LEVEL_OPTIONS: {
  value: ThinkingLevel
  label: string
  tokens: string
}[] = [
  { value: 'off', label: 'Off', tokens: 'Disabled' },
  { value: 'think', label: 'Think', tokens: '4K' },
  { value: 'megathink', label: 'Megathink', tokens: '10K' },
  { value: 'ultrathink', label: 'Ultrathink', tokens: '32K' },
]

/** Effort level options for Opus 4.6 adaptive thinking */
export const EFFORT_LEVEL_OPTIONS: {
  value: EffortLevel
  label: string
  description: string
}[] = [
  { value: 'low', label: 'Low', description: 'Minimal' },
  { value: 'medium', label: 'Medium', description: 'Moderate' },
  { value: 'high', label: 'High', description: 'Deep' },
  { value: 'max', label: 'Max', description: 'No limits' },
]

/** Get display label and color for PR status */
function getPrStatusDisplay(status: PrDisplayStatus): {
  label: string
  className: string
} {
  switch (status) {
    case 'draft':
      return { label: 'Draft', className: 'text-muted-foreground' }
    case 'open':
      return { label: 'Open', className: 'text-green-600 dark:text-green-500' }
    case 'merged':
      return {
        label: 'Merged',
        className: 'text-purple-600 dark:text-purple-400',
      }
    case 'closed':
      return { label: 'Closed', className: 'text-red-600 dark:text-red-400' }
    default:
      return { label: 'Unknown', className: 'text-muted-foreground' }
  }
}

/** Check status icon component */
function CheckStatusIcon({ status }: { status: CheckStatus | null }) {
  if (!status) return null

  switch (status) {
    case 'success':
      return null
    case 'failure':
    case 'error':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-1 h-2 w-2 rounded-full bg-red-500" />
          </TooltipTrigger>
          <TooltipContent>Checks failing</TooltipContent>
        </Tooltip>
      )
    case 'pending':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-1 h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
          </TooltipTrigger>
          <TooltipContent>Checks pending</TooltipContent>
        </Tooltip>
      )
    default:
      return null
  }
}

interface ChatToolbarProps {
  // State
  isSending: boolean
  hasPendingQuestions: boolean
  hasPendingAttachments: boolean
  hasInputValue: boolean
  executionMode: ExecutionMode
  selectedModel: ClaudeModel
  selectedProvider: string | null // null = default (Anthropic), or profile name
  selectedThinkingLevel: ThinkingLevel
  selectedEffortLevel: EffortLevel
  thinkingOverrideActive: boolean // True when thinking is disabled in build/yolo due to preference
  useAdaptiveThinking: boolean // True when model supports effort (Opus on CLI >= 2.1.32)
  hideThinkingLevel?: boolean // True when selected provider doesn't support thinking
  providerLocked?: boolean // True after first message — provider can't change mid-session

  // Git state
  baseBranch: string
  uncommittedAdded: number
  uncommittedRemoved: number
  branchDiffAdded: number
  branchDiffRemoved: number

  // PR state
  prUrl: string | undefined
  prNumber: number | undefined
  displayStatus: PrDisplayStatus | undefined
  checkStatus: CheckStatus | undefined
  mergeableStatus: MergeableStatus | undefined

  // Shortcuts
  magicModalShortcut: string

  // Worktree info
  activeWorktreePath: string | undefined
  worktreeId: string | null
  activeSessionId: string | null | undefined
  projectId: string | undefined

  // Issue/PR/Saved context
  loadedIssueContexts: LoadedIssueContext[]
  loadedPRContexts: LoadedPullRequestContext[]
  attachedSavedContexts: AttachedSavedContext[]

  // Callbacks
  onOpenMagicModal: () => void
  onSaveContext: () => void
  onLoadContext: () => void
  onCommit: () => void
  onCommitAndPush: () => void
  onOpenPr: () => void
  onReview: () => void
  onMerge: () => void
  onResolvePrConflicts: () => void
  onResolveConflicts: () => void
  hasOpenPr: boolean
  onSetDiffRequest: (request: DiffRequest) => void
  onModelChange: (model: ClaudeModel) => void
  onProviderChange: (provider: string | null) => void
  customCliProfiles: CustomCliProfile[]
  onThinkingLevelChange: (level: ThinkingLevel) => void
  onEffortLevelChange: (level: EffortLevel) => void
  onSetExecutionMode: (mode: ExecutionMode) => void
  onCancel: () => void
  queuedMessageCount?: number

  // MCP servers
  availableMcpServers: McpServerInfo[]
  enabledMcpServers: string[]
  onToggleMcpServer: (serverName: string) => void
  onOpenProjectSettings?: () => void
}

/** Compact health status dot for the toolbar MCP dropdown */
/** Hover hint for MCP server health status in the toolbar dropdown */
function mcpStatusHint(
  status: McpHealthStatus | undefined
): string | undefined {
  switch (status) {
    case 'needsAuthentication':
      return "Needs authentication — run 'claude /mcp' to authenticate"
    case 'couldNotConnect':
      return 'Could not connect to server'
    case 'connected':
      return 'Connected'
    default:
      return undefined
  }
}

/** Compact health status dot for the toolbar MCP dropdown */
function McpStatusDot({ status }: { status: McpHealthStatus | undefined }) {
  if (!status) return null

  switch (status) {
    case 'connected':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <CheckCircle className="size-3 text-green-600 dark:text-green-400" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Connected</TooltipContent>
        </Tooltip>
      )
    case 'needsAuthentication':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <ShieldAlert className="size-3 text-amber-600 dark:text-amber-400" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {"Needs authentication — run 'claude /mcp' to authenticate"}
          </TooltipContent>
        </Tooltip>
      )
    case 'couldNotConnect':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <XCircle className="size-3 text-red-600 dark:text-red-400" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Could not connect to server</TooltipContent>
        </Tooltip>
      )
    default:
      return null
  }
}

/**
 * Memoized toolbar component to prevent re-renders when parent state changes.
 * This component only re-renders when its props change.
 */
export const ChatToolbar = memo(function ChatToolbar({
  isSending,
  hasPendingQuestions,
  hasPendingAttachments,
  hasInputValue,
  executionMode,
  selectedModel,
  selectedProvider,
  selectedThinkingLevel,
  selectedEffortLevel,
  thinkingOverrideActive,
  useAdaptiveThinking,
  hideThinkingLevel,
  providerLocked,
  baseBranch,
  uncommittedAdded,
  uncommittedRemoved,
  branchDiffAdded,
  branchDiffRemoved,
  prUrl,
  prNumber,
  displayStatus,
  checkStatus,
  mergeableStatus,
  magicModalShortcut,
  activeWorktreePath,
  worktreeId,
  activeSessionId,
  projectId,
  loadedIssueContexts,
  loadedPRContexts,
  attachedSavedContexts,
  onOpenMagicModal,
  onSaveContext,
  onLoadContext,
  onCommit,
  onCommitAndPush,
  onOpenPr,
  onReview,
  onMerge,
  onResolvePrConflicts,
  onResolveConflicts,
  hasOpenPr,
  onSetDiffRequest,
  onModelChange,
  onProviderChange,
  customCliProfiles,
  onThinkingLevelChange,
  onEffortLevelChange,
  onSetExecutionMode,
  onCancel,
  queuedMessageCount,
  availableMcpServers,
  enabledMcpServers,
  onToggleMcpServer,
  onOpenProjectSettings,
}: ChatToolbarProps) {
  // MCP health check — triggered when dropdown opens, shared cache with settings pane
  const {
    data: healthResult,
    isFetching: isHealthChecking,
    refetch: checkHealth,
  } = useMcpHealthCheck()

  const [mcpDropdownOpen, setMcpDropdownOpen] = useState(false)

  useEffect(() => {
    if (mcpDropdownOpen) {
      checkHealth()
    }
  }, [mcpDropdownOpen, checkHealth])

  // Count only enabled servers that actually exist and aren't disabled
  const activeMcpCount = useMemo(() => {
    const availableNames = new Set(
      availableMcpServers.filter(s => !s.disabled).map(s => s.name)
    )
    return enabledMcpServers.filter(name => availableNames.has(name)).length
  }, [availableMcpServers, enabledMcpServers])

  // For custom providers: show generic tier names (Opus/Sonnet/Haiku) without version numbers,
  // and drop Opus 4.5 (providers only have one opus-tier model).
  // Parse actual model names from the provider's settings JSON when available.
  const filteredModelOptions = useMemo(() => {
    if (!selectedProvider) return MODEL_OPTIONS
    // Try to extract model names from the active profile's settings_json
    const profile = customCliProfiles.find(p => p.name === selectedProvider)
    let opusModel: string | undefined
    let sonnetModel: string | undefined
    let haikuModel: string | undefined
    if (profile?.settings_json) {
      try {
        const settings = JSON.parse(profile.settings_json)
        const env = settings?.env
        if (env) {
          opusModel = env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_MODEL
          sonnetModel = env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_MODEL
          haikuModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_MODEL
        }
      } catch { /* ignore parse errors */ }
    }
    const suffix = (model?: string) => model ? ` (${model})` : ''
    return [
      { value: 'opus' as ClaudeModel, label: `Opus${suffix(opusModel)}` },
      { value: 'sonnet' as ClaudeModel, label: `Sonnet${suffix(sonnetModel)}` },
      { value: 'haiku' as ClaudeModel, label: `Haiku${suffix(haikuModel)}` },
    ]
  }, [selectedProvider, customCliProfiles])

  // Memoize callbacks to prevent Select re-renders
  const handleModelChange = useCallback(
    (value: string) => {
      onModelChange(value as ClaudeModel)
    },
    [onModelChange]
  )

  const handleProviderChange = useCallback(
    (value: string) => {
      const provider = value === 'default' ? null : value
      onProviderChange(provider)
      // Auto-switch from Opus 4.6 when selecting a custom provider (it's Anthropic-only)
      if (provider && provider !== '__anthropic__' && selectedModel === 'opus-4.5') {
        onModelChange('opus' as ClaudeModel)
      }
    },
    [onProviderChange, onModelChange, selectedModel]
  )

  const handleThinkingLevelChange = useCallback(
    (value: string) => {
      onThinkingLevelChange(value as ThinkingLevel)
    },
    [onThinkingLevelChange]
  )

  const handleEffortLevelChange = useCallback(
    (value: string) => {
      onEffortLevelChange(value as EffortLevel)
    },
    [onEffortLevelChange]
  )

  const handlePullClick = useCallback(async () => {
    if (!activeWorktreePath || !worktreeId) return
    await performGitPull({
      worktreeId,
      worktreePath: activeWorktreePath,
      baseBranch,
      projectId,
      onMergeConflict: onResolveConflicts,
    })
  }, [
    activeWorktreePath,
    baseBranch,
    worktreeId,
    projectId,
    onResolveConflicts,
  ])

  const handlePushClick = useCallback(async () => {
    if (!activeWorktreePath || !worktreeId) return
    const { setWorktreeLoading, clearWorktreeLoading } = useChatStore.getState()
    setWorktreeLoading(worktreeId, 'push')
    const toastId = toast.loading('Pushing changes...')
    try {
      await gitPush(activeWorktreePath, prNumber)
      triggerImmediateGitPoll()
      if (projectId) fetchWorktreesStatus(projectId)
      toast.success('Changes pushed', { id: toastId })
    } catch (error) {
      toast.error(`Push failed: ${error}`, { id: toastId })
    } finally {
      clearWorktreeLoading(worktreeId)
    }
  }, [activeWorktreePath, worktreeId, projectId, prNumber])

  const handleUncommittedDiffClick = useCallback(() => {
    onSetDiffRequest({
      type: 'uncommitted',
      worktreePath: activeWorktreePath ?? '',
      baseBranch,
    })
  }, [activeWorktreePath, baseBranch, onSetDiffRequest])

  const handleBranchDiffClick = useCallback(() => {
    onSetDiffRequest({
      type: 'branch',
      worktreePath: activeWorktreePath ?? '',
      baseBranch,
    })
  }, [activeWorktreePath, baseBranch, onSetDiffRequest])

  // Context viewer state
  const [viewingContext, setViewingContext] = useState<{
    type: 'issue' | 'pr' | 'saved'
    number?: number
    slug?: string
    title: string
    content: string
  } | null>(null)

  const handleViewIssue = useCallback(
    async (ctx: LoadedIssueContext) => {
      if (!activeSessionId || !activeWorktreePath) return
      try {
        const content = await getIssueContextContent(
          activeSessionId,
          ctx.number,
          activeWorktreePath
        )
        setViewingContext({
          type: 'issue',
          number: ctx.number,
          title: ctx.title,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [activeSessionId, activeWorktreePath]
  )

  const handleViewPR = useCallback(
    async (ctx: LoadedPullRequestContext) => {
      if (!activeSessionId || !activeWorktreePath) return
      try {
        const content = await getPRContextContent(
          activeSessionId,
          ctx.number,
          activeWorktreePath
        )
        setViewingContext({
          type: 'pr',
          number: ctx.number,
          title: ctx.title,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [activeSessionId, activeWorktreePath]
  )

  const handleViewSavedContext = useCallback(
    async (ctx: AttachedSavedContext) => {
      if (!activeSessionId) return
      try {
        const content = await getSavedContextContent(activeSessionId, ctx.slug)
        setViewingContext({
          type: 'saved',
          slug: ctx.slug,
          title: ctx.name || ctx.slug,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [activeSessionId]
  )

  // Compute counts from arrays
  const loadedIssueCount = loadedIssueContexts.length
  const loadedPRCount = loadedPRContexts.length
  const loadedContextCount = attachedSavedContexts.length

  const isDisabled = isSending || hasPendingQuestions
  const canSend = hasInputValue || hasPendingAttachments

  return (
    <div className="@container px-4 py-2 md:px-6">
      {/* Controls - segmented button group */}
      <div className="inline-flex items-center rounded-lg bg-muted/50">
        {/* Mobile overflow menu - only visible on small screens */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex @md:hidden h-8 items-center gap-1 rounded-l-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={isDisabled}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {/* Context section */}
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Context
            </div>
            <DropdownMenuItem onClick={onSaveContext}>
              <BookmarkPlus className="h-4 w-4" />
              Save Context
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                S
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLoadContext}>
              <FolderOpen className="h-4 w-4" />
              Load Context
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                L
              </span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Commit section */}
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Commit
            </div>
            <DropdownMenuItem onClick={onCommit}>
              <GitCommitHorizontal className="h-4 w-4" />
              Commit
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                C
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCommitAndPush}>
              <GitCommitHorizontal className="h-4 w-4" />
              Commit & Push
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                P
              </span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Sync section */}
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Sync
            </div>
            <DropdownMenuItem onClick={handlePullClick}>
              <ArrowDownToLine className="h-4 w-4" />
              Pull
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                D
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handlePushClick}>
              <ArrowUpToLine className="h-4 w-4" />
              Push
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                U
              </span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Pull Request section */}
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Pull Request
            </div>
            <DropdownMenuItem onClick={onOpenPr}>
              <GitPullRequest className="h-4 w-4" />
              {hasOpenPr ? 'Open' : 'Create'}
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                O
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReview}>
              <Eye className="h-4 w-4" />
              Review
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                R
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            {/* Branch section */}
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Branch
            </div>
            <DropdownMenuItem onClick={onMerge}>
              <GitMerge className="h-4 w-4" />
              Merge to Base
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                M
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onResolveConflicts}>
              <GitMerge className="h-4 w-4" />
              Resolve Conflicts
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                F
              </span>
            </DropdownMenuItem>
            {/* Git stats section - conditional */}
            {(uncommittedAdded > 0 ||
              uncommittedRemoved > 0 ||
              branchDiffAdded > 0 ||
              branchDiffRemoved > 0 ||
              prUrl) && <DropdownMenuSeparator />}

            {/* Uncommitted diff */}
            {(uncommittedAdded > 0 || uncommittedRemoved > 0) && (
              <DropdownMenuItem onClick={handleUncommittedDiffClick}>
                <Pencil className="h-4 w-4" />
                <span>Uncommitted</span>
                <span className="ml-auto text-xs">
                  <span className="text-green-500">+{uncommittedAdded}</span>
                  {' / '}
                  <span className="text-red-500">-{uncommittedRemoved}</span>
                </span>
              </DropdownMenuItem>
            )}

            {/* Branch diff */}
            {(branchDiffAdded > 0 || branchDiffRemoved > 0) && (
              <DropdownMenuItem onClick={handleBranchDiffClick}>
                <GitBranch className="h-4 w-4" />
                <span>Branch diff</span>
                <span className="ml-auto text-xs">
                  <span className="text-green-500">+{branchDiffAdded}</span>
                  {' / '}
                  <span className="text-red-500">-{branchDiffRemoved}</span>
                </span>
              </DropdownMenuItem>
            )}

            {/* PR link */}
            {prUrl && prNumber && (
              <DropdownMenuItem asChild>
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    displayStatus
                      ? getPrStatusDisplay(displayStatus).className
                      : ''
                  )}
                >
                  {displayStatus === 'merged' ? (
                    <GitMerge className="h-4 w-4" />
                  ) : (
                    <GitPullRequest className="h-4 w-4" />
                  )}
                  <span>
                    {displayStatus
                      ? getPrStatusDisplay(displayStatus).label
                      : 'Open'}{' '}
                    #{prNumber}
                  </span>
                  <CheckStatusIcon status={checkStatus ?? null} />
                </a>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {/* Provider selector as submenu */}
            {customCliProfiles.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={providerLocked}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  <span>Provider</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {!selectedProvider || selectedProvider === '__anthropic__' ? 'Anthropic' : selectedProvider}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={selectedProvider ?? '__anthropic__'}
                    onValueChange={handleProviderChange}
                  >
                    <DropdownMenuRadioItem value="__anthropic__">
                      Anthropic
                    </DropdownMenuRadioItem>
                    {customCliProfiles.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          Custom Providers
                        </DropdownMenuLabel>
                        {customCliProfiles.map(profile => (
                          <DropdownMenuRadioItem
                            key={profile.name}
                            value={profile.name}
                          >
                            {profile.name}
                          </DropdownMenuRadioItem>
                        ))}
                      </>
                    )}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            {/* Model selector as submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sparkles className="mr-2 h-4 w-4" />
                <span>Model</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {filteredModelOptions.find(o => o.value === selectedModel)?.label}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={selectedModel}
                  onValueChange={handleModelChange}
                >
                  {filteredModelOptions.map(option => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Thinking/Effort level as submenu */}
            {hideThinkingLevel ? null : useAdaptiveThinking ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Brain className="mr-2 h-4 w-4" />
                  <span>Effort</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {thinkingOverrideActive
                      ? 'Off'
                      : EFFORT_LEVEL_OPTIONS.find(
                          o => o.value === selectedEffortLevel
                        )?.label}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={thinkingOverrideActive ? '' : selectedEffortLevel}
                    onValueChange={handleEffortLevelChange}
                  >
                    {EFFORT_LEVEL_OPTIONS.map(option => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                        <span className="ml-auto pl-4 text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Brain className="mr-2 h-4 w-4" />
                  <span>Thinking</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {thinkingOverrideActive
                      ? 'Off'
                      : THINKING_LEVEL_OPTIONS.find(
                          o => o.value === selectedThinkingLevel
                        )?.label}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={
                      thinkingOverrideActive ? 'off' : selectedThinkingLevel
                    }
                    onValueChange={handleThinkingLevelChange}
                  >
                    {THINKING_LEVEL_OPTIONS.map(option => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                        <span className="ml-auto pl-4 text-xs text-muted-foreground">
                          {option.tokens}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            {/* Execution mode as submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {executionMode === 'plan' && (
                  <ClipboardList className="mr-2 h-4 w-4" />
                )}
                {executionMode === 'build' && (
                  <Hammer className="mr-2 h-4 w-4" />
                )}
                {executionMode === 'yolo' && <Zap className="mr-2 h-4 w-4" />}
                <span>Mode</span>
                <span className="ml-auto text-xs text-muted-foreground capitalize">
                  {executionMode}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={executionMode}
                  onValueChange={v => onSetExecutionMode(v as ExecutionMode)}
                >
                  <DropdownMenuRadioItem value="plan">
                    Plan
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="build">
                    Build
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioItem
                    value="yolo"
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  >
                    Yolo
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Divider after overflow menu - mobile only */}
        <div className="block @md:hidden h-4 w-px bg-border/50" />

        {/* Magic modal button - desktop only */}
        <button
          type="button"
          className="hidden @md:flex h-8 items-center gap-1 rounded-l-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={isDisabled}
          onClick={onOpenMagicModal}
        >
          <Wand2 className="h-3.5 w-3.5" />
          <Kbd className="ml-0.5 h-4 text-[10px] opacity-50">
            {magicModalShortcut}
          </Kbd>
        </button>

        {/* Issue/PR/Context dropdown - desktop only */}
        {(loadedIssueCount > 0 ||
          loadedPRCount > 0 ||
          loadedContextCount > 0) && (
          <>
            <div className="hidden @md:block h-4 w-px bg-border/50" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="hidden @md:flex h-8 items-center gap-1.5 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
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
                {/* Issues section */}
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

                {/* PRs section */}
                {loadedPRContexts.length > 0 && (
                  <>
                    {loadedIssueContexts.length > 0 && (
                      <DropdownMenuSeparator />
                    )}
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

                {/* Saved contexts section */}
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

                {/* Manage button */}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLoadContext}>
                  <FolderOpen className="h-4 w-4" />
                  Manage Contexts...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* PR link indicator - desktop only */}
        {prUrl && prNumber && (
          <>
            <div className="hidden @md:block h-4 w-px bg-border/50" />
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'hidden @md:flex h-8 items-center gap-1.5 px-3 text-sm transition-colors select-none hover:bg-muted/80 hover:text-foreground',
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
                  <span>
                    {displayStatus
                      ? getPrStatusDisplay(displayStatus).label
                      : 'Open'}{' '}
                    #{prNumber}
                  </span>
                  <CheckStatusIcon status={checkStatus ?? null} />
                </a>
              </TooltipTrigger>
              <TooltipContent>{`Open PR #${prNumber} on GitHub`}</TooltipContent>
            </Tooltip>
          </>
        )}

        {/* PR conflicts indicator - desktop only */}
        {mergeableStatus === 'conflicting' && (
          <>
            <div className="hidden @md:block h-4 w-px bg-border/50" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="hidden @md:flex h-8 items-center gap-1.5 px-3 text-sm text-amber-600 dark:text-amber-400 transition-colors cursor-pointer hover:bg-muted/80"
                  onClick={onResolvePrConflicts}
                >
                  <GitMerge className="h-3 w-3" />
                  <span>Conflicts</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                PR has merge conflicts — click to resolve
              </TooltipContent>
            </Tooltip>
          </>
        )}

        {/* Provider selector - desktop only, shown when profiles exist */}
        {customCliProfiles.length > 0 && (
          <>
            <div className="hidden @md:block h-4 w-px bg-border/50" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={hasPendingQuestions || providerLocked}
                  className={cn(
                    'hidden @md:flex h-8 items-center gap-1.5 px-3 text-sm transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                    selectedProvider && selectedProvider !== '__anthropic__'
                      ? 'border border-blue-500/50 bg-blue-500/10 text-blue-700 dark:border-blue-400/40 dark:bg-blue-500/10 dark:text-blue-400'
                      : 'text-muted-foreground'
                  )}
                >
                  <span>{!selectedProvider || selectedProvider === '__anthropic__' ? 'Anthropic' : selectedProvider}</span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-40">
                <DropdownMenuRadioGroup
                  value={selectedProvider ?? '__anthropic__'}
                  onValueChange={handleProviderChange}
                >
                  <DropdownMenuRadioItem value="__anthropic__">
                    Anthropic
                  </DropdownMenuRadioItem>
                  {customCliProfiles.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1.5">
                        Custom Providers
                        <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium leading-none">cc</span>
                      </DropdownMenuLabel>
                      {customCliProfiles.map(profile => (
                        <DropdownMenuRadioItem
                          key={profile.name}
                          value={profile.name}
                        >
                          {profile.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </>
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* Divider - desktop only */}
        <div className="hidden @md:block h-4 w-px bg-border/50" />

        {/* Model selector - desktop only */}
        <Select
          value={selectedModel}
          onValueChange={handleModelChange}
          disabled={hasPendingQuestions}
        >
          <SelectTrigger className="hidden @md:flex h-8 w-auto gap-1.5 rounded-none border-0 bg-transparent px-3 text-sm text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground dark:bg-transparent dark:hover:bg-muted/80 [&>svg:last-child]:size-3">
            <Sparkles className="h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filteredModelOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Divider - desktop only */}
        {!hideThinkingLevel && <div className="hidden @md:block h-4 w-px bg-border/50" />}

        {/* Thinking/Effort level dropdown - desktop only */}
        {hideThinkingLevel ? null : useAdaptiveThinking ? (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={hasPendingQuestions}
                    className={cn(
                      'hidden @md:flex h-8 items-center gap-1.5 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                      !thinkingOverrideActive &&
                        'border border-purple-500/50 bg-purple-500/10 text-purple-700 dark:border-purple-400/40 dark:bg-purple-500/10 dark:text-purple-400'
                    )}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    <span>
                      {thinkingOverrideActive
                        ? 'Off'
                        : EFFORT_LEVEL_OPTIONS.find(
                            o => o.value === selectedEffortLevel
                          )?.label}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {thinkingOverrideActive
                  ? `Effort disabled in ${executionMode} mode (change in Settings)`
                  : `Effort: ${EFFORT_LEVEL_OPTIONS.find(o => o.value === selectedEffortLevel)?.label}`}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={thinkingOverrideActive ? '' : selectedEffortLevel}
                onValueChange={handleEffortLevelChange}
              >
                {EFFORT_LEVEL_OPTIONS.map(option => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                  >
                    <Brain className="mr-2 h-4 w-4" />
                    {option.label}
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={hasPendingQuestions}
                    className={cn(
                      'hidden @md:flex h-8 items-center gap-1.5 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                      selectedThinkingLevel !== 'off' &&
                        !thinkingOverrideActive &&
                        'border border-purple-500/50 bg-purple-500/10 text-purple-700 dark:border-purple-400/40 dark:bg-purple-500/10 dark:text-purple-400'
                    )}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    <span>
                      {thinkingOverrideActive
                        ? 'Off'
                        : THINKING_LEVEL_OPTIONS.find(
                            o => o.value === selectedThinkingLevel
                          )?.label}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {thinkingOverrideActive
                  ? `Thinking disabled in ${executionMode} mode (change in Settings)`
                  : `Thinking: ${THINKING_LEVEL_OPTIONS.find(o => o.value === selectedThinkingLevel)?.label}`}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={thinkingOverrideActive ? 'off' : selectedThinkingLevel}
                onValueChange={handleThinkingLevelChange}
              >
                {THINKING_LEVEL_OPTIONS.map(option => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                  >
                    <Brain className="mr-2 h-4 w-4" />
                    {option.label}
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">
                      {option.tokens}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Divider - desktop only */}
        <div className="hidden @md:block h-4 w-px bg-border/50" />

        {/* Execution mode dropdown - desktop only */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={hasPendingQuestions}
                  className={cn(
                    'hidden @md:flex h-8 items-center gap-1.5 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                    executionMode === 'plan' &&
                      'border border-yellow-600/50 bg-yellow-500/10 text-yellow-700 dark:border-yellow-500/40 dark:bg-yellow-500/10 dark:text-yellow-400',
                    executionMode === 'yolo' &&
                      'border border-red-500/50 bg-red-500/10 text-red-600 dark:border-red-400/40 dark:text-red-400'
                  )}
                >
                  {executionMode === 'plan' && (
                    <ClipboardList className="h-3.5 w-3.5" />
                  )}
                  {executionMode === 'build' && (
                    <Hammer className="h-3.5 w-3.5" />
                  )}
                  {executionMode === 'yolo' && <Zap className="h-3.5 w-3.5" />}
                  <span className="capitalize">{executionMode}</span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{`${executionMode.charAt(0).toUpperCase() + executionMode.slice(1)} mode (Shift+Tab to cycle)`}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={executionMode}
              onValueChange={v => onSetExecutionMode(v as ExecutionMode)}
            >
              <DropdownMenuRadioItem value="plan">
                <ClipboardList className="mr-2 h-4 w-4" />
                Plan
                <span className="ml-auto pl-4 text-xs text-muted-foreground">
                  Read-only
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="build">
                <Hammer className="mr-2 h-4 w-4" />
                Build
                <span className="ml-auto pl-4 text-xs text-muted-foreground">
                  Auto-edits
                </span>
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

        {/* Divider */}
        <div className="h-4 w-px bg-border/50" />

        {/* MCP servers button - desktop only */}
        <DropdownMenu open={mcpDropdownOpen} onOpenChange={setMcpDropdownOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={hasPendingQuestions}
                  className={cn(
                    'hidden @md:flex h-8 items-center gap-1.5 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                    activeMcpCount > 0 &&
                      'border border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-400'
                  )}
                >
                  <Plug className="h-3.5 w-3.5" />
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
                const status = healthResult?.statuses[server.name]
                return (
                  <Tooltip key={server.name}>
                    <TooltipTrigger asChild>
                      <DropdownMenuCheckboxItem
                        checked={
                          !server.disabled &&
                          enabledMcpServers.includes(server.name)
                        }
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
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      {mcpStatusHint(status)}
                    </TooltipContent>
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

        {/* Send/Cancel button */}
        {isSending ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onCancel}
                className="flex h-8 items-center justify-center gap-1.5 rounded-r-lg px-3 text-sm transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <span>{queuedMessageCount ? 'Skip to Next' : 'Cancel'}</span>
                <Kbd className="ml-0.5 h-4 text-[10px] bg-primary-foreground/20 text-primary-foreground">
                  {isMacOS ? `${getModifierSymbol()}⌥⌫` : 'Ctrl+Alt+⌫'}
                </Kbd>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {queuedMessageCount
                ? `Skip to next queued message (${isMacOS ? `${getModifierSymbol()}+Option+Backspace` : 'Ctrl+Alt+Backspace'})`
                : `Cancel (${isMacOS ? `${getModifierSymbol()}+Option+Backspace` : 'Ctrl+Alt+Backspace'})`}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="submit"
                disabled={hasPendingQuestions || !canSend}
                className={cn(
                  'flex h-8 items-center justify-center gap-1.5 rounded-r-lg px-3 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50',
                  canSend
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
              >
                <Send className="h-3.5 w-3.5" />
                <Kbd
                  className={cn(
                    'ml-0.5 h-4 text-[10px]',
                    canSend
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'opacity-50'
                  )}
                >
                  Enter
                </Kbd>
              </button>
            </TooltipTrigger>
            <TooltipContent>Send message (Enter)</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Context viewer dialog */}
      {viewingContext && (
        <Dialog open={true} onOpenChange={() => setViewingContext(null)}>
          <DialogContent className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none sm:!w-[calc(100vw-8rem)] sm:!max-w-[calc(100vw-8rem)] sm:!h-[calc(100vh-8rem)] sm:!rounded-lg flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewingContext.type === 'issue' && (
                  <CircleDot className="h-4 w-4 text-green-500" />
                )}
                {viewingContext.type === 'pr' && (
                  <GitPullRequest className="h-4 w-4 text-green-500" />
                )}
                {viewingContext.type === 'saved' && (
                  <FolderOpen className="h-4 w-4 text-blue-500" />
                )}
                {viewingContext.number ? `#${viewingContext.number}: ` : ''}
                {viewingContext.title}
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0">
              <Markdown className="p-4">{viewingContext.content}</Markdown>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
})
