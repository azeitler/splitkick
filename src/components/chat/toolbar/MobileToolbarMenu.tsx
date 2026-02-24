import {
  ArrowDownToLine,
  ArrowUpToLine,
  BookmarkPlus,
  Brain,
  ClipboardList,
  Eye,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Hammer,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Zap,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { CustomCliProfile } from '@/types/preferences'
import type { EffortLevel, ExecutionMode, ThinkingLevel } from '@/types/chat'
import type { CheckStatus, PrDisplayStatus } from '@/types/pr-status'
import { CheckStatusButton } from '@/components/chat/toolbar/CheckStatusButton'
import {
  EFFORT_LEVEL_OPTIONS,
  THINKING_LEVEL_OPTIONS,
} from '@/components/chat/toolbar/toolbar-options'
import {
  getPrStatusDisplay,
  getProviderDisplayName,
} from '@/components/chat/toolbar/toolbar-utils'
import { cn } from '@/lib/utils'

interface MobileToolbarMenuProps {
  isDisabled: boolean
  hasOpenPr: boolean
  sessionHasMessages?: boolean
  providerLocked?: boolean
  selectedBackend: 'claude' | 'codex' | 'opencode'
  selectedProvider: string | null
  selectedModel: string
  selectedEffortLevel: EffortLevel
  selectedThinkingLevel: ThinkingLevel
  hideThinkingLevel?: boolean
  useAdaptiveThinking: boolean
  isCodex: boolean
  executionMode: ExecutionMode
  customCliProfiles: CustomCliProfile[]
  filteredModelOptions: { value: string; label: string }[]

  uncommittedAdded: number
  uncommittedRemoved: number
  branchDiffAdded: number
  branchDiffRemoved: number
  prUrl: string | undefined
  prNumber: number | undefined
  displayStatus: PrDisplayStatus | undefined
  checkStatus: CheckStatus | undefined
  activeWorktreePath: string | undefined

  onSaveContext: () => void
  onLoadContext: () => void
  onCommit: () => void
  onCommitAndPush: () => void
  onOpenPr: () => void
  onReview: () => void
  onMerge: () => void
  onResolveConflicts: () => void
  installedBackends: ('claude' | 'codex' | 'opencode')[]
  onBackendChange: (backend: 'claude' | 'codex' | 'opencode') => void
  onSetExecutionMode: (mode: ExecutionMode) => void

  handlePullClick: () => void
  handlePushClick: () => void
  handleUncommittedDiffClick: () => void
  handleBranchDiffClick: () => void
  handleProviderChange: (value: string) => void
  handleModelChange: (value: string) => void
  handleEffortLevelChange: (value: string) => void
  handleThinkingLevelChange: (value: string) => void
}

export function MobileToolbarMenu({
  isDisabled,
  hasOpenPr,
  sessionHasMessages,
  providerLocked,
  selectedBackend,
  selectedProvider,
  selectedModel,
  selectedEffortLevel,
  selectedThinkingLevel,
  hideThinkingLevel,
  useAdaptiveThinking,
  isCodex,
  executionMode,
  customCliProfiles,
  filteredModelOptions,
  uncommittedAdded,
  uncommittedRemoved,
  branchDiffAdded,
  branchDiffRemoved,
  prUrl,
  prNumber,
  displayStatus,
  checkStatus,
  activeWorktreePath,
  onSaveContext,
  onLoadContext,
  onCommit,
  onCommitAndPush,
  onOpenPr,
  onReview,
  onMerge,
  onResolveConflicts,
  installedBackends,
  onBackendChange,
  onSetExecutionMode,
  handlePullClick,
  handlePushClick,
  handleUncommittedDiffClick,
  handleBranchDiffClick,
  handleProviderChange,
  handleModelChange,
  handleEffortLevelChange,
  handleThinkingLevelChange,
}: MobileToolbarMenuProps) {
  const providerDisplayName = getProviderDisplayName(selectedProvider)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex @xl:hidden h-8 items-center gap-1 rounded-l-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={isDisabled}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
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

        {(uncommittedAdded > 0 ||
          uncommittedRemoved > 0 ||
          branchDiffAdded > 0 ||
          branchDiffRemoved > 0 ||
          prUrl) && <DropdownMenuSeparator />}

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

        {prUrl && prNumber && (
          <DropdownMenuItem asChild>
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                displayStatus ? getPrStatusDisplay(displayStatus).className : ''
              )}
            >
              {displayStatus === 'merged' ? (
                <GitMerge className="h-4 w-4" />
              ) : (
                <GitPullRequest className="h-4 w-4" />
              )}
              <span>#{prNumber}</span>
              <CheckStatusButton
                status={checkStatus ?? null}
                projectPath={activeWorktreePath}
              />
            </a>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {!sessionHasMessages && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Sparkles className="mr-2 h-4 w-4" />
              <span>Backend</span>
              <span className="ml-auto text-xs text-muted-foreground capitalize">
                {selectedBackend}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={selectedBackend}
                onValueChange={v =>
                  onBackendChange(v as 'claude' | 'codex' | 'opencode')
                }
              >
                {installedBackends.includes('claude') && (
                  <DropdownMenuRadioItem value="claude">
                    Claude
                  </DropdownMenuRadioItem>
                )}
                {installedBackends.includes('codex') && (
                  <DropdownMenuRadioItem value="codex">
                    Codex{' '}
                    <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                      BETA
                    </span>
                  </DropdownMenuRadioItem>
                )}
                {installedBackends.includes('opencode') && (
                  <DropdownMenuRadioItem value="opencode">
                    OpenCode{' '}
                    <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                      BETA
                    </span>
                  </DropdownMenuRadioItem>
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {customCliProfiles.length > 0 &&
          !providerLocked &&
          selectedBackend === 'claude' && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sparkles className="mr-2 h-4 w-4" />
                <span>Provider</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {providerDisplayName}
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

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sparkles className="mr-2 h-4 w-4" />
            <span>Model</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {filteredModelOptions.find(o => o.value === selectedModel)?.label}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {providerLocked && customCliProfiles.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Provider: {providerDisplayName}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuRadioGroup
              value={selectedModel}
              onValueChange={handleModelChange}
            >
              {filteredModelOptions.map(option => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {hideThinkingLevel ? null : useAdaptiveThinking || isCodex ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Brain className="mr-2 h-4 w-4" />
              <span>Effort</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {
                  EFFORT_LEVEL_OPTIONS.find(
                    o => o.value === selectedEffortLevel
                  )?.label
                }
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={selectedEffortLevel}
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
                {
                  THINKING_LEVEL_OPTIONS.find(
                    o => o.value === selectedThinkingLevel
                  )?.label
                }
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={selectedThinkingLevel}
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

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {executionMode === 'plan' && (
              <ClipboardList className="mr-2 h-4 w-4" />
            )}
            {executionMode === 'build' && <Hammer className="mr-2 h-4 w-4" />}
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
              <DropdownMenuRadioItem value="plan">Plan</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="build">Build</DropdownMenuRadioItem>
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
  )
}
