import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Eye,
  FileText,
  Wand2,
  BookmarkPlus,
  FolderOpen,
  Search,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useWorktree, useProjects } from '@/services/projects'
import { usePreferences } from '@/services/preferences'
import { invoke } from '@/lib/transport'
import { openExternal } from '@/lib/platform'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  gitPull,
  gitPush,
  triggerImmediateGitPoll,
  fetchWorktreesStatus,
} from '@/services/git-status'
import type { CreateCommitResponse } from '@/types/projects'

type MagicOption =
  | 'save-context'
  | 'load-context'
  | 'commit'
  | 'commit-and-push'
  | 'pull'
  | 'push'
  | 'open-pr'
  | 'review'
  | 'merge'
  | 'resolve-conflicts'
  | 'investigate'
  | 'checkout-pr'
  | 'release-notes'

/** Options that work on canvas without an open session (git-only operations) */
const CANVAS_ALLOWED_OPTIONS = new Set<MagicOption>([
  'commit',
  'commit-and-push',
  'pull',
  'push',
  'release-notes',
])

interface MagicOptionItem {
  id: MagicOption
  label: string
  icon: typeof GitCommitHorizontal
  key: string
}

interface MagicSection {
  header: string
  options: MagicOptionItem[]
}

interface MagicColumns {
  left: MagicSection[]
  right: MagicSection[]
  all: MagicSection[]
}

function buildMagicColumns(hasOpenPr: boolean): MagicColumns {
  const left: MagicSection[] = [
    {
      header: 'Context',
      options: [
        {
          id: 'save-context',
          label: 'Save Context',
          icon: BookmarkPlus,
          key: 'S',
        },
        {
          id: 'load-context',
          label: 'Load Context',
          icon: FolderOpen,
          key: 'L',
        },
      ],
    },
    {
      header: 'Commit',
      options: [
        { id: 'commit', label: 'Commit', icon: GitCommitHorizontal, key: 'C' },
        {
          id: 'commit-and-push',
          label: 'Commit & Push',
          icon: GitCommitHorizontal,
          key: 'P',
        },
      ],
    },
    {
      header: 'Sync',
      options: [
        { id: 'pull', label: 'Pull', icon: ArrowDownToLine, key: 'D' },
        { id: 'push', label: 'Push', icon: ArrowUpToLine, key: 'U' },
      ],
    },
  ]

  const right: MagicSection[] = [
    {
      header: 'Pull Request',
      options: [
        {
          id: 'open-pr',
          label: hasOpenPr ? 'Open' : 'Create',
          icon: GitPullRequest,
          key: 'O',
        },
        { id: 'review', label: 'Review', icon: Eye, key: 'R' },
        { id: 'checkout-pr', label: 'Checkout', icon: GitBranch, key: 'K' },
      ],
    },
    {
      header: 'Release',
      options: [
        {
          id: 'release-notes',
          label: 'Generate Notes',
          icon: FileText,
          key: 'G',
        },
      ],
    },
    {
      header: 'Branch',
      options: [
        { id: 'merge', label: 'Merge to Base', icon: GitMerge, key: 'M' },
        {
          id: 'resolve-conflicts',
          label: 'Resolve Conflicts',
          icon: GitMerge,
          key: 'F',
        },
        {
          id: 'investigate',
          label: 'Investigate Context',
          icon: Search,
          key: 'I',
        },
      ],
    },
  ]

  return { left, right, all: [...left, ...right] }
}

/** Keyboard shortcut to option ID mapping */
const KEY_TO_OPTION: Record<string, MagicOption> = {
  s: 'save-context',
  l: 'load-context',
  c: 'commit',
  p: 'commit-and-push',
  d: 'pull',
  u: 'push',
  o: 'open-pr',
  r: 'review',
  m: 'merge',
  f: 'resolve-conflicts',
  i: 'investigate',
  k: 'checkout-pr',
  g: 'release-notes',
}

export function MagicModal() {
  const { magicModalOpen, setMagicModalOpen, sessionChatModalWorktreeId } =
    useUIStore()
  const selectedWorktreeIdFromProjects = useProjectsStore(
    state => state.selectedWorktreeId
  )
  const activeWorktreeId = useChatStore(state => state.activeWorktreeId)
  // Fall back chain: projects store → chat store → session modal worktree
  // Session modal worktree is set when user opens a session from canvas view
  const selectedWorktreeId =
    selectedWorktreeIdFromProjects ??
    activeWorktreeId ??
    sessionChatModalWorktreeId
  const { data: worktree } = useWorktree(selectedWorktreeId)
  const hasInitializedRef = useRef(false)
  const [selectedOption, setSelectedOption] =
    useState<MagicOption>('save-context')

  const hasOpenPr = Boolean(worktree?.pr_url)

  // Detect if we're on a canvas view (without a session modal open)
  const isViewingCanvasTab = useChatStore(state => {
    const wtId =
      selectedWorktreeIdFromProjects ?? state.activeWorktreeId
    return wtId ? (state.viewingCanvasTab[wtId] ?? true) : false
  })
  const sessionModalOpen = useUIStore(state => state.sessionChatModalOpen)
  const isOnCanvas = isViewingCanvasTab && !sessionModalOpen

  // Build columns dynamically based on PR state
  const magicColumns = useMemo(
    () => buildMagicColumns(hasOpenPr),
    [hasOpenPr]
  )

  // Flatten all options for arrow key navigation
  const allOptions = useMemo(
    () => magicColumns.all.flatMap(section => section.options.map(opt => opt.id)),
    [magicColumns]
  )

  // Reset selection tracking when modal closes
  useEffect(() => {
    if (!magicModalOpen) {
      hasInitializedRef.current = false
    }
  }, [magicModalOpen])

  // Initialize selection when modal opens
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !hasInitializedRef.current) {
        setSelectedOption(isOnCanvas ? 'commit' : 'save-context')
        hasInitializedRef.current = true
      }
      setMagicModalOpen(open)
    },
    [setMagicModalOpen, isOnCanvas]
  )

  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const { data: preferences } = usePreferences()
  const { data: projects } = useProjects()
  const project = worktree
    ? projects?.find(p => p.id === worktree.project_id)
    : null

  // Direct git execution for when ChatWindow isn't rendered (project canvas)
  const executeGitDirectly = useCallback(
    async (option: MagicOption) => {
      if (!selectedWorktreeId || !worktree?.path) return

      const { setWorktreeLoading, clearWorktreeLoading } =
        useChatStore.getState()

      switch (option) {
        case 'commit':
        case 'commit-and-push': {
          setWorktreeLoading(selectedWorktreeId, 'commit')
          const isPush = option === 'commit-and-push'
          const branch = worktree.branch ?? ''
          const toastId = toast.loading(
            isPush ? `Committing and pushing on ${branch}...` : `Creating commit on ${branch}...`
          )
          try {
            const result = await invoke<CreateCommitResponse>(
              'create_commit_with_ai',
              {
                worktreePath: worktree.path,
                customPrompt: preferences?.magic_prompts?.commit_message,
                push: isPush,
                model: preferences?.magic_prompt_models?.commit_message_model,
              }
            )
            triggerImmediateGitPoll()
            if (worktree.project_id) fetchWorktreesStatus(worktree.project_id)
            const prefix = isPush ? 'Committed and pushed' : 'Committed'
            toast.success(`${prefix}: ${result.message.split('\n')[0]}`, {
              id: toastId,
            })
          } catch (error) {
            toast.error(`Failed: ${error}`, { id: toastId })
          } finally {
            clearWorktreeLoading(selectedWorktreeId)
          }
          break
        }
        case 'pull': {
          setWorktreeLoading(selectedWorktreeId, 'pull')
          const toastId = toast.loading(`Pulling changes on ${worktree.branch}...`)
          try {
            const baseBranch = project?.default_branch ?? 'main'
            await gitPull(worktree.path, baseBranch)
            triggerImmediateGitPoll()
            if (worktree.project_id) fetchWorktreesStatus(worktree.project_id)
            toast.success('Changes pulled', { id: toastId })
          } catch (error) {
            toast.error(`Pull failed: ${error}`, { id: toastId })
          } finally {
            clearWorktreeLoading(selectedWorktreeId)
          }
          break
        }
        case 'push': {
          const toastId = toast.loading(`Pushing ${worktree.branch}...`)
          try {
            await gitPush(worktree.path, worktree.pr_number)
            triggerImmediateGitPoll()
            if (worktree.project_id) fetchWorktreesStatus(worktree.project_id)
            toast.success('Changes pushed', { id: toastId })
          } catch (error) {
            toast.error(`Push failed: ${error}`, { id: toastId })
          }
          break
        }
      }
    },
    [selectedWorktreeId, worktree, preferences, project]
  )

  const executeAction = useCallback(
    async (option: MagicOption) => {
      // Block disabled options on canvas
      if (isOnCanvas && !CANVAS_ALLOWED_OPTIONS.has(option)) {
        return
      }

      // checkout-pr only needs a project selected, not a worktree
      // Handle it directly here since ChatWindow may not be rendered
      if (option === 'checkout-pr') {
        if (!selectedProjectId) {
          notify('No project selected', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        // Open the checkout PR modal directly
        useUIStore.getState().setCheckoutPRModalOpen(true)
        setMagicModalOpen(false)
        return
      }

      // release-notes only needs a project selected, not a worktree
      if (option === 'release-notes') {
        if (!selectedProjectId) {
          notify('No project selected', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        useUIStore.getState().setReleaseNotesModalOpen(true)
        setMagicModalOpen(false)
        return
      }

      if (!selectedWorktreeId) {
        notify('No worktree selected', undefined, { type: 'error' })
        setMagicModalOpen(false)
        return
      }

      // If PR already exists, open it in the browser instead of creating a new one
      if (option === 'open-pr' && worktree?.pr_url) {
        await openExternal(worktree.pr_url)
        setMagicModalOpen(false)
        return
      }

      // For canvas-allowed git ops: if no ChatWindow rendered, execute directly
      if (
        CANVAS_ALLOWED_OPTIONS.has(option) &&
        !useChatStore.getState().activeWorktreePath
      ) {
        setMagicModalOpen(false)
        executeGitDirectly(option)
        return
      }

      // Dispatch magic command for ChatWindow to handle
      window.dispatchEvent(
        new CustomEvent('magic-command', { detail: { command: option } })
      )

      setMagicModalOpen(false)
    },
    [selectedWorktreeId, selectedProjectId, setMagicModalOpen, worktree?.pr_url, isOnCanvas, executeGitDirectly]
  )

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Check for direct key shortcuts (s, l, c, p, r)
      const mappedOption = KEY_TO_OPTION[key]
      if (mappedOption) {
        e.preventDefault()
        executeAction(mappedOption)
        return
      }

      if (key === 'enter') {
        e.preventDefault()
        executeAction(selectedOption)
      } else if (key === 'arrowdown' || key === 'arrowup') {
        e.preventDefault()
        const currentIndex = allOptions.indexOf(selectedOption)
        const newIndex =
          key === 'arrowdown'
            ? (currentIndex + 1) % allOptions.length
            : (currentIndex - 1 + allOptions.length) % allOptions.length
        const newOptionId = allOptions[newIndex]
        if (newOptionId) {
          setSelectedOption(newOptionId)
        }
      }
    },
    [executeAction, selectedOption, allOptions]
  )

  return (
    <Dialog open={magicModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] p-0" onKeyDown={handleKeyDown}>
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Magic
          </DialogTitle>
        </DialogHeader>

        <div className="pb-2 grid grid-cols-2">
          {[magicColumns.left, magicColumns.right].map(
            (columnSections, colIndex) => (
              <div
                key={colIndex}
                className={cn(colIndex === 0 && 'border-r border-border')}
              >
                {columnSections.map((section, sectionIndex) => (
                  <div key={section.header}>
                    {/* Section header */}
                    <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {section.header}
                    </div>

                    {/* Section options */}
                    {section.options.map(option => {
                      const Icon = option.icon
                      const isSelected = selectedOption === option.id
                      const isDisabled =
                        isOnCanvas && !CANVAS_ALLOWED_OPTIONS.has(option.id)

                      return (
                        <button
                          key={option.id}
                          onClick={() =>
                            !isDisabled && executeAction(option.id)
                          }
                          onMouseEnter={() => setSelectedOption(option.id)}
                          className={cn(
                            'w-full flex items-center justify-between px-4 py-2 text-sm transition-colors',
                            'focus:outline-none',
                            isDisabled
                              ? 'opacity-40 cursor-not-allowed'
                              : 'hover:bg-accent',
                            isSelected && !isDisabled && 'bg-accent'
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span>{option.label}</span>
                          </div>
                          <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {option.key}
                          </kbd>
                        </button>
                      )
                    })}

                    {/* Separator between sections within column (not after last) */}
                    {sectionIndex < columnSections.length - 1 && (
                      <div className="my-1 mx-4 border-t border-border" />
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default MagicModal
