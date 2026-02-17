import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getModifierSymbol } from '@/lib/platform'
import { invoke } from '@/lib/transport'
import { useQueryClient } from '@tanstack/react-query'
import {
  GitBranch,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  CircleDot,
  AlertCircle,
  Wand2,
  Zap,
  Settings,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { isGhAuthError, isNewIssue } from '@/services/github'
import { useGhLogin } from '@/hooks/useGhLogin'
import { GhAuthError } from '@/components/shared/GhAuthError'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import {
  useGitHubIssues,
  useGitHubPRs,
  useSearchGitHubIssues,
  useSearchGitHubPRs,
  filterIssues,
  filterPRs,
  mergeWithSearchResults,
  githubQueryKeys,
} from '@/services/github'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  useProjects,
  useWorktrees,
  useCreateWorktree,
  useCreateBaseSession,
  useProjectBranches,
  useCreateWorktreeFromExistingBranch,
  useJeanConfig,
  projectsQueryKeys,
} from '@/services/projects'
import { isBaseSession } from '@/types/projects'
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueContext,
  PullRequestContext,
} from '@/types/github'

export type TabId = 'quick' | 'issues' | 'prs' | 'branches'

export interface Tab {
  id: TabId
  label: string
  key: string
  icon: LucideIcon
}

// eslint-disable-next-line react-refresh/only-export-components
export const TABS: Tab[] = [
  { id: 'quick', label: 'Actions', key: '1', icon: Zap },
  { id: 'issues', label: 'Issues', key: '2', icon: CircleDot },
  { id: 'prs', label: 'PRs', key: '3', icon: GitPullRequest },
  { id: 'branches', label: 'Branches', key: '4', icon: GitBranch },
]

export function NewWorktreeModal() {
  const queryClient = useQueryClient()
  const { triggerLogin: triggerGhLogin, isGhInstalled } = useGhLogin()
  const { newWorktreeModalOpen, setNewWorktreeModalOpen } = useUIStore()
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)

  // Get project data
  const { data: projects } = useProjects()
  const selectedProject = useMemo(
    () => projects?.find(p => p.id === selectedProjectId),
    [projects, selectedProjectId]
  )

  // Get worktrees to check for existing base session
  const { data: worktrees } = useWorktrees(selectedProjectId)
  const hasBaseSession = useMemo(
    () => worktrees?.some(w => isBaseSession(w)) ?? false,
    [worktrees]
  )
  const baseSession = useMemo(
    () => worktrees?.find(w => isBaseSession(w)),
    [worktrees]
  )

  // Local state
  const [activeTab, setActiveTab] = useState<TabId>('quick')
  const [searchQuery, setSearchQuery] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const [selectedItemIndex, setSelectedItemIndex] = useState(0)
  const [creatingFromNumber, setCreatingFromNumber] = useState<number | null>(
    null
  )
  const [creatingFromBranch, setCreatingFromBranch] = useState<string | null>(
    null
  )

  const searchInputRef = useRef<HTMLInputElement>(null)

  // GitHub issues query
  const issueState = includeClosed ? 'all' : 'open'
  const {
    data: issueResult,
    isLoading: isLoadingIssues,
    isFetching: isRefetchingIssues,
    error: issuesError,
    refetch: refetchIssues,
  } = useGitHubIssues(selectedProject?.path ?? null, issueState)
  const issues = issueResult?.issues

  // GitHub PRs query
  const prState = includeClosed ? 'all' : 'open'
  const {
    data: prs,
    isLoading: isLoadingPRs,
    isFetching: isRefetchingPRs,
    error: prsError,
    refetch: refetchPRs,
  } = useGitHubPRs(selectedProject?.path ?? null, prState)

  // Debounced search query for GitHub API search
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)

  // GitHub search queries (triggered when local filter may miss results)
  const { data: searchedIssues, isFetching: isSearchingIssues } =
    useSearchGitHubIssues(selectedProject?.path ?? null, debouncedSearchQuery)

  const { data: searchedPRs, isFetching: isSearchingPRs } = useSearchGitHubPRs(
    selectedProject?.path ?? null,
    debouncedSearchQuery
  )

  // Filter issues locally, then merge with remote search results
  const filteredIssues = useMemo(
    () =>
      mergeWithSearchResults(
        filterIssues(issues ?? [], searchQuery),
        searchedIssues
      ),
    [issues, searchQuery, searchedIssues]
  )

  // Filter PRs locally, then merge with remote search results
  const filteredPRs = useMemo(
    () =>
      mergeWithSearchResults(filterPRs(prs ?? [], searchQuery), searchedPRs),
    [prs, searchQuery, searchedPRs]
  )

  // Branches query
  const {
    data: branches,
    isLoading: isLoadingBranches,
    isFetching: isRefetchingBranches,
    error: branchesError,
    refetch: refetchBranches,
  } = useProjectBranches(selectedProjectId)

  // Filter branches locally (exclude the base/default branch)
  const filteredBranches = useMemo(() => {
    if (!branches) return []
    const baseBranch = selectedProject?.default_branch
    const filtered = branches.filter(b => b !== baseBranch)
    if (!searchQuery) return filtered
    const q = searchQuery.toLowerCase()
    return filtered.filter(b => b.toLowerCase().includes(q))
  }, [branches, searchQuery, selectedProject?.default_branch])

  // Mutations
  const createWorktree = useCreateWorktree()
  const createBaseSession = useCreateBaseSession()
  const createWorktreeFromBranch = useCreateWorktreeFromExistingBranch()

  // Apply store-provided default tab when modal opens (e.g. from NewIssuesBadge click)
  useEffect(() => {
    if (newWorktreeModalOpen) {
      const { newWorktreeModalDefaultTab, setNewWorktreeModalDefaultTab } =
        useUIStore.getState()
      if (newWorktreeModalDefaultTab) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab(newWorktreeModalDefaultTab)
        setNewWorktreeModalDefaultTab(null)
      }
    }
  }, [newWorktreeModalOpen])

  // Focus search input when switching to issues or prs tab
  useEffect(() => {
    if (
      (activeTab === 'issues' ||
        activeTab === 'prs' ||
        activeTab === 'branches') &&
      newWorktreeModalOpen
    ) {
      // Small delay to ensure the input is mounted
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [activeTab, newWorktreeModalOpen])

  // Reset selection when switching tabs
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedItemIndex(0)
    setSearchQuery('')
  }, [activeTab])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // Always reset these states on open/close
      setCreatingFromNumber(null)
      setCreatingFromBranch(null)
      setSearchQuery('')
      setSelectedItemIndex(0)

      if (open) {
        // Reset other state when modal opens
        // Use store-provided default tab (e.g. from NewIssuesBadge click), fallback to issues/quick
        const { newWorktreeModalDefaultTab, setNewWorktreeModalDefaultTab } =
          useUIStore.getState()
        setActiveTab(
          newWorktreeModalDefaultTab ?? (selectedProjectId ? 'issues' : 'quick')
        )
        setNewWorktreeModalDefaultTab(null)
        setIncludeClosed(false)

        // Invalidate GitHub caches to fetch fresh data
        const projectPath = selectedProject?.path
        if (projectPath) {
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.issues(projectPath, 'open'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.issues(projectPath, 'all'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.prs(projectPath, 'open'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.prs(projectPath, 'all'),
          })
        }
        if (selectedProjectId) {
          queryClient.invalidateQueries({
            queryKey: [
              ...projectsQueryKeys.detail(selectedProjectId),
              'branches',
            ],
          })
        }
      }
      setNewWorktreeModalOpen(open)
    },
    [setNewWorktreeModalOpen, selectedProject, queryClient, selectedProjectId]
  )

  const handleCreateWorktree = useCallback(() => {
    if (!selectedProjectId) {
      toast.error('No project selected')
      return
    }
    createWorktree.mutate({ projectId: selectedProjectId })
    handleOpenChange(false)
  }, [selectedProjectId, createWorktree, handleOpenChange])

  const handleBaseSession = useCallback(() => {
    if (!selectedProjectId) {
      toast.error('No project selected')
      return
    }

    if (hasBaseSession && baseSession) {
      // Switch to existing base session
      const { selectWorktree } = useProjectsStore.getState()
      const { setActiveWorktree } = useChatStore.getState()
      selectWorktree(baseSession.id)
      setActiveWorktree(baseSession.id, baseSession.path)
      toast.success(`Switched to base session: ${baseSession.name}`)
    } else {
      // Create new base session
      createBaseSession.mutate(selectedProjectId)
    }
    handleOpenChange(false)
  }, [
    selectedProjectId,
    hasBaseSession,
    baseSession,
    createBaseSession,
    handleOpenChange,
  ])

  const handleSelectBranch = useCallback(
    (branchName: string, background = false) => {
      if (!selectedProjectId) {
        toast.error('No project selected')
        return
      }
      setCreatingFromBranch(branchName)
      if (background) useUIStore.getState().incrementPendingBackgroundCreations()
      createWorktreeFromBranch.mutate(
        { projectId: selectedProjectId, branchName, background },
        {
          onError: () => setCreatingFromBranch(null),
          onSuccess: () => {
            if (background) setCreatingFromBranch(null)
          },
        }
      )
      if (!background) handleOpenChange(false)
    },
    [selectedProjectId, createWorktreeFromBranch, handleOpenChange]
  )

  const handleSelectIssue = useCallback(
    async (issue: GitHubIssue, background = false) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(issue.number)

      try {
        // Fetch full issue details including comments
        const issueDetail = await invoke<
          GitHubIssue & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
          }
        >('get_github_issue', {
          projectPath,
          issueNumber: issue.number,
        })

        // Create issue context for the worktree
        // Note: Backend expects camelCase for comments (createdAt not created_at)
        const issueContext: IssueContext = {
          number: issueDetail.number,
          title: issueDetail.title,
          body: issueDetail.body,
          comments: (issueDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
        }

        // Create worktree with issue context
        if (background) useUIStore.getState().incrementPendingBackgroundCreations()
        createWorktree.mutate({
          projectId: selectedProjectId,
          issueContext,
          background,
        })

        if (background) {
          setCreatingFromNumber(null)
        } else {
          handleOpenChange(false)
        }
      } catch (error) {
        toast.error(`Failed to fetch issue details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  // Handle selecting an issue AND triggering auto-investigate after worktree creation
  const handleSelectIssueAndInvestigate = useCallback(
    async (issue: GitHubIssue, background = false) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(issue.number)

      try {
        // Fetch full issue details including comments
        const issueDetail = await invoke<
          GitHubIssue & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
          }
        >('get_github_issue', {
          projectPath,
          issueNumber: issue.number,
        })

        // Create issue context for the worktree
        const issueContext: IssueContext = {
          number: issueDetail.number,
          title: issueDetail.title,
          body: issueDetail.body,
          comments: (issueDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
        }

        // Set investigate flag BEFORE mutateAsync so it's available
        // when worktree:created or worktree:unarchived fires
        useUIStore.getState().setPendingInvestigateType('issue')
        if (background) useUIStore.getState().incrementPendingBackgroundCreations()

        await createWorktree.mutateAsync({
          projectId: selectedProjectId,
          issueContext,
          background,
        })

        if (background) {
          setCreatingFromNumber(null)
        } else {
          handleOpenChange(false)
        }
      } catch (error) {
        toast.error(`Failed to fetch issue details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  const handleSelectPR = useCallback(
    async (pr: GitHubPullRequest, background = false) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(pr.number)

      try {
        // Fetch full PR details including comments and reviews
        const prDetail = await invoke<
          GitHubPullRequest & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
            reviews: {
              body: string
              state: string
              author: { login: string }
              submittedAt?: string
            }[]
          }
        >('get_github_pr', {
          projectPath,
          prNumber: pr.number,
        })

        // Create PR context for the worktree
        const prContext: PullRequestContext = {
          number: prDetail.number,
          title: prDetail.title,
          body: prDetail.body,
          headRefName: prDetail.headRefName,
          baseRefName: prDetail.baseRefName,
          comments: (prDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
          reviews: (prDetail.reviews ?? [])
            .filter(r => r && r.author)
            .map(r => ({
              body: r.body ?? '',
              state: r.state,
              author: { login: r.author.login ?? '' },
              submittedAt: r.submittedAt,
            })),
        }

        // Create worktree with PR context
        if (background) useUIStore.getState().incrementPendingBackgroundCreations()
        createWorktree.mutate({
          projectId: selectedProjectId,
          prContext,
          background,
        })

        if (background) {
          setCreatingFromNumber(null)
        } else {
          handleOpenChange(false)
        }
      } catch (error) {
        toast.error(`Failed to fetch PR details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  // Handle selecting a PR AND triggering auto-investigate after worktree creation
  const handleSelectPRAndInvestigate = useCallback(
    async (pr: GitHubPullRequest, background = false) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(pr.number)

      try {
        // Fetch full PR details including comments and reviews
        const prDetail = await invoke<
          GitHubPullRequest & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
            reviews: {
              body: string
              state: string
              author: { login: string }
              submittedAt?: string
            }[]
          }
        >('get_github_pr', {
          projectPath,
          prNumber: pr.number,
        })

        // Create PR context for the worktree
        const prContext: PullRequestContext = {
          number: prDetail.number,
          title: prDetail.title,
          body: prDetail.body,
          headRefName: prDetail.headRefName,
          baseRefName: prDetail.baseRefName,
          comments: (prDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
          reviews: (prDetail.reviews ?? [])
            .filter(r => r && r.author)
            .map(r => ({
              body: r.body ?? '',
              state: r.state,
              author: { login: r.author.login ?? '' },
              submittedAt: r.submittedAt,
            })),
        }

        // Set investigate flag BEFORE mutateAsync so it's available
        // when worktree:created or worktree:unarchived fires
        useUIStore.getState().setPendingInvestigateType('pr')
        if (background) useUIStore.getState().incrementPendingBackgroundCreations()

        await createWorktree.mutateAsync({
          projectId: selectedProjectId,
          prContext,
          background,
        })

        if (background) {
          setCreatingFromNumber(null)
        } else {
          handleOpenChange(false)
        }
      } catch (error) {
        toast.error(`Failed to fetch PR details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Tab shortcuts (Cmd+key, works even when input is focused)
      if (e.metaKey || e.ctrlKey) {
        if (key === '1') {
          e.preventDefault()
          setActiveTab('quick')
          return
        }
        if (key === '2') {
          e.preventDefault()
          setActiveTab('issues')
          return
        }
        if (key === '3') {
          e.preventDefault()
          setActiveTab('prs')
          return
        }
        if (key === '4') {
          e.preventDefault()
          setActiveTab('branches')
          return
        }
      }

      // Quick actions shortcuts (skip when typing in an input)
      if (activeTab === 'quick') {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          if (key === 'n') {
            e.preventDefault()
            e.nativeEvent.stopImmediatePropagation()
            handleCreateWorktree()
            return
          }
          if (key === 'm') {
            e.preventDefault()
            e.nativeEvent.stopImmediatePropagation()
            handleBaseSession()
            return
          }
        }
      }

      // Issues tab navigation
      if (activeTab === 'issues' && filteredIssues.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex(prev =>
            Math.min(prev + 1, filteredIssues.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredIssues[selectedItemIndex]) {
          e.preventDefault()
          handleSelectIssue(filteredIssues[selectedItemIndex], e.metaKey)
          return
        }
        if (key === 'm' && filteredIssues[selectedItemIndex]) {
          e.preventDefault()
          handleSelectIssueAndInvestigate(filteredIssues[selectedItemIndex], e.metaKey)
          return
        }
      }

      // PRs tab navigation
      if (activeTab === 'prs' && filteredPRs.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex(prev =>
            Math.min(prev + 1, filteredPRs.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredPRs[selectedItemIndex]) {
          e.preventDefault()
          handleSelectPR(filteredPRs[selectedItemIndex], e.metaKey)
          return
        }
        if (key === 'm' && filteredPRs[selectedItemIndex]) {
          e.preventDefault()
          handleSelectPRAndInvestigate(filteredPRs[selectedItemIndex], e.metaKey)
          return
        }
      }

      // Branches tab navigation
      if (activeTab === 'branches' && filteredBranches.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex(prev =>
            Math.min(prev + 1, filteredBranches.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredBranches[selectedItemIndex]) {
          e.preventDefault()
          handleSelectBranch(filteredBranches[selectedItemIndex], e.metaKey)
          return
        }
      }
    },
    [
      activeTab,
      filteredIssues,
      filteredPRs,
      filteredBranches,
      selectedItemIndex,
      handleCreateWorktree,
      handleBaseSession,
      handleSelectIssue,
      handleSelectIssueAndInvestigate,
      handleSelectPR,
      handleSelectPRAndInvestigate,
      handleSelectBranch,
    ]
  )

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector(
      `[data-item-index="${selectedItemIndex}"]`
    )
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedItemIndex])

  return (
    <Dialog open={newWorktreeModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none sm:!w-[90vw] sm:!max-w-[90vw] sm:!h-[85vh] sm:!max-h-[85vh] sm:!rounded-lg p-0 flex flex-col overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-4 pt-5 pb-2">
          <DialogTitle>
            New Session for {selectedProject?.name ?? 'Project'}
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <SessionTabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Tab content */}
        <div className="flex-1 min-h-0 flex flex-col">
          {activeTab === 'quick' && (
            <QuickActionsTab
              hasBaseSession={hasBaseSession}
              onCreateWorktree={handleCreateWorktree}
              onBaseSession={handleBaseSession}
              isCreating={
                createWorktree.isPending || createBaseSession.isPending
              }
              projectId={selectedProjectId}
              projectPath={selectedProject?.path ?? null}
            />
          )}

          {activeTab === 'issues' && (
            <GitHubIssuesTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              includeClosed={includeClosed}
              setIncludeClosed={setIncludeClosed}
              issues={filteredIssues}
              isLoading={isLoadingIssues}
              isRefetching={isRefetchingIssues}
              isSearching={isSearchingIssues}
              error={issuesError}
              onRefresh={() => refetchIssues()}
              selectedIndex={selectedItemIndex}
              setSelectedIndex={setSelectedItemIndex}
              onSelectIssue={handleSelectIssue}
              onInvestigateIssue={handleSelectIssueAndInvestigate}
              creatingFromNumber={creatingFromNumber}
              searchInputRef={searchInputRef}
              onGhLogin={triggerGhLogin}
              isGhInstalled={isGhInstalled}
            />
          )}

          {activeTab === 'prs' && (
            <GitHubPRsTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              includeClosed={includeClosed}
              setIncludeClosed={setIncludeClosed}
              prs={filteredPRs}
              isLoading={isLoadingPRs}
              isRefetching={isRefetchingPRs}
              isSearching={isSearchingPRs}
              error={prsError}
              onRefresh={() => refetchPRs()}
              selectedIndex={selectedItemIndex}
              setSelectedIndex={setSelectedItemIndex}
              onSelectPR={handleSelectPR}
              onInvestigatePR={handleSelectPRAndInvestigate}
              creatingFromNumber={creatingFromNumber}
              searchInputRef={searchInputRef}
              onGhLogin={triggerGhLogin}
              isGhInstalled={isGhInstalled}
            />
          )}

          {activeTab === 'branches' && (
            <BranchesTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              branches={filteredBranches}
              isLoading={isLoadingBranches}
              isRefetching={isRefetchingBranches}
              error={branchesError}
              onRefresh={() => refetchBranches()}
              selectedIndex={selectedItemIndex}
              setSelectedIndex={setSelectedItemIndex}
              onSelectBranch={handleSelectBranch}
              creatingFromBranch={creatingFromBranch}
              searchInputRef={searchInputRef}
            />
          )}
        </div>

        {/* Background open hint */}
        {activeTab !== 'quick' && (
          <div className="shrink-0 border-t border-border px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              Hold <kbd className="mx-0.5 rounded bg-muted px-1 py-0.5 text-[10px]">{getModifierSymbol()}</kbd> to open in background
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function SessionTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}) {
  return (
    <div className="flex border-b border-border">
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          tabIndex={-1}
          className={cn(
            'flex-1 px-4 py-2 text-sm font-medium transition-colors',
            'flex items-center justify-center gap-1.5',
            'hover:bg-accent focus:outline-none',
            'border-b-2',
            activeTab === tab.id
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground'
          )}
        >
          <tab.icon className="h-4 w-4" />
          <span className="text-xs sm:text-sm">{tab.label}</span>
          <kbd className="hidden sm:inline ml-0.5 text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">
            {getModifierSymbol()}+{tab.key}
          </kbd>
        </button>
      ))}
    </div>
  )
}

export interface QuickActionsTabProps {
  hasBaseSession: boolean
  onCreateWorktree: () => void
  onBaseSession: () => void
  isCreating: boolean
  projectId: string | null
  projectPath: string | null
}

export function QuickActionsTab({
  hasBaseSession,
  onCreateWorktree,
  onBaseSession,
  isCreating,
  projectId,
  projectPath,
}: QuickActionsTabProps) {
  const { data: jeanConfig } = useJeanConfig(projectPath)
  const setupScript = jeanConfig?.scripts.setup
  const runScript = jeanConfig?.scripts.run
  const { setNewWorktreeModalOpen } = useUIStore.getState()

  const handleRunClick = () => {
    if (!projectId) return
    if (!runScript) {
      // No run script — open project settings to jean.json pane
      setNewWorktreeModalOpen(false)
      useProjectsStore.getState().openProjectSettings(projectId, 'jean-json')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-4 sm:p-10">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 w-full max-w-xl">
        {/* Base Session button */}
        <button
          onClick={onBaseSession}
          disabled={isCreating}
          className={cn(
            'relative flex flex-col items-center justify-center gap-4 sm:aspect-square p-4 sm:p-8 rounded-xl text-sm transition-colors',
            'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
            'border border-border'
          )}
        >
          <GitBranch className="h-10 w-10 text-muted-foreground" />
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-medium text-base">
              {hasBaseSession ? 'Switch to Base Session' : 'New Base Session'}
            </span>
            <span className="text-xs text-muted-foreground text-center">
              Work directly on the project folder
            </span>
          </div>
          <kbd className="hidden sm:block absolute top-3 right-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            M
          </kbd>
        </button>

        {/* New Worktree button */}
        <button
          onClick={onCreateWorktree}
          disabled={isCreating}
          className={cn(
            'relative flex flex-col items-center justify-center gap-4 sm:aspect-square p-4 sm:p-8 rounded-xl text-sm transition-colors',
            'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
            'border border-border'
          )}
        >
          {isCreating ? (
            <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
          ) : (
            <Plus className="h-10 w-10 text-muted-foreground" />
          )}
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-medium text-base">New Worktree</span>
            <span className="text-xs text-muted-foreground text-center">
              Create an isolated branch for your task
            </span>
            {setupScript && (
              <span className="text-xs text-muted-foreground/70 font-mono truncate max-w-[200px]">
                Setup: {setupScript}
              </span>
            )}
          </div>
          <kbd className="hidden sm:block absolute top-3 right-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            N
          </kbd>
        </button>
      </div>

      {/* Configure jean.json - only show when not configured */}
      {!runScript && projectId && (
        <div className="flex items-center gap-1 mt-6">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleRunClick}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground/40 hover:text-foreground hover:bg-accent cursor-pointer transition-colors"
              >
                <Settings className="h-4 w-4" />
                <span>Configure jean.json</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Configure jean.json</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

export interface GitHubIssuesTabProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  includeClosed: boolean
  setIncludeClosed: (include: boolean) => void
  issues: GitHubIssue[]
  isLoading: boolean
  isRefetching: boolean
  isSearching: boolean
  error: Error | null
  onRefresh: () => void
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  onSelectIssue: (issue: GitHubIssue, background?: boolean) => void
  onInvestigateIssue: (issue: GitHubIssue, background?: boolean) => void
  creatingFromNumber: number | null
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onGhLogin: () => void
  isGhInstalled: boolean
}

export function GitHubIssuesTab({
  searchQuery,
  setSearchQuery,
  includeClosed,
  setIncludeClosed,
  issues,
  isLoading,
  isRefetching,
  isSearching,
  error,
  onRefresh,
  selectedIndex,
  setSelectedIndex,
  onSelectIssue,
  onInvestigateIssue,
  creatingFromNumber,
  searchInputRef,
  onGhLogin,
  isGhInstalled,
}: GitHubIssuesTabProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search and filters */}
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search issues by #number, title, or description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRefresh}
                disabled={isRefetching}
                className={cn(
                  'flex items-center justify-center h-8 w-8 rounded-md border border-border',
                  'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
                  'transition-colors',
                  isRefetching && 'opacity-50 cursor-not-allowed'
                )}
              >
                <RefreshCw
                  className={cn(
                    'h-4 w-4 text-muted-foreground',
                    isRefetching && 'animate-spin'
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh issues</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-closed"
            checked={includeClosed}
            onCheckedChange={checked => setIncludeClosed(checked === true)}
          />
          <label
            htmlFor="include-closed"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Include closed issues
          </label>
        </div>
      </div>

      {/* Issues list */}
      <ScrollArea className="flex-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading issues...
            </span>
          </div>
        )}

        {error &&
          (isGhAuthError(error) ? (
            <GhAuthError onLogin={onGhLogin} isGhInstalled={isGhInstalled} />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <AlertCircle className="h-5 w-5 text-destructive mb-2" />
              <span className="text-sm text-muted-foreground">
                {error.message || 'Failed to load issues'}
              </span>
            </div>
          ))}

        {!isLoading && !error && issues.length === 0 && !isSearching && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">
              {searchQuery
                ? 'No issues match your search'
                : 'No open issues found'}
            </span>
          </div>
        )}

        {!isLoading && !error && issues.length === 0 && isSearching && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Searching GitHub...
            </span>
          </div>
        )}

        {!isLoading && !error && issues.length > 0 && (
          <div className="py-1">
            {issues.map((issue, index) => (
              <IssueItem
                key={issue.number}
                issue={issue}
                index={index}
                isSelected={index === selectedIndex}
                isCreating={creatingFromNumber === issue.number}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={(bg) => onSelectIssue(issue, bg)}
                onInvestigate={(bg) => onInvestigateIssue(issue, bg)}
              />
            ))}
            {isSearching && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="ml-1.5 text-xs text-muted-foreground">
                  Searching GitHub for more results...
                </span>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

export interface GitHubPRsTabProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  includeClosed: boolean
  setIncludeClosed: (include: boolean) => void
  prs: GitHubPullRequest[]
  isLoading: boolean
  isRefetching: boolean
  isSearching: boolean
  error: Error | null
  onRefresh: () => void
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  onSelectPR: (pr: GitHubPullRequest, background?: boolean) => void
  onInvestigatePR: (pr: GitHubPullRequest, background?: boolean) => void
  creatingFromNumber: number | null
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onGhLogin: () => void
  isGhInstalled: boolean
}

export function GitHubPRsTab({
  searchQuery,
  setSearchQuery,
  includeClosed,
  setIncludeClosed,
  prs,
  isLoading,
  isRefetching,
  isSearching,
  error,
  onRefresh,
  selectedIndex,
  setSelectedIndex,
  onSelectPR,
  onInvestigatePR,
  creatingFromNumber,
  searchInputRef,
  onGhLogin,
  isGhInstalled,
}: GitHubPRsTabProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search and filters */}
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search PRs by #number, title, branch, or description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRefresh}
                disabled={isRefetching}
                className={cn(
                  'flex items-center justify-center h-8 w-8 rounded-md border border-border',
                  'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
                  'transition-colors',
                  isRefetching && 'opacity-50 cursor-not-allowed'
                )}
              >
                <RefreshCw
                  className={cn(
                    'h-4 w-4 text-muted-foreground',
                    isRefetching && 'animate-spin'
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh pull requests</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-closed-prs"
            checked={includeClosed}
            onCheckedChange={checked => setIncludeClosed(checked === true)}
          />
          <label
            htmlFor="include-closed-prs"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Include closed/merged PRs
          </label>
        </div>
      </div>

      {/* PRs list */}
      <ScrollArea className="flex-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading pull requests...
            </span>
          </div>
        )}

        {error &&
          (isGhAuthError(error) ? (
            <GhAuthError onLogin={onGhLogin} isGhInstalled={isGhInstalled} />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <AlertCircle className="h-5 w-5 text-destructive mb-2" />
              <span className="text-sm text-muted-foreground">
                {error.message || 'Failed to load pull requests'}
              </span>
            </div>
          ))}

        {!isLoading && !error && prs.length === 0 && !isSearching && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">
              {searchQuery
                ? 'No PRs match your search'
                : 'No open pull requests found'}
            </span>
          </div>
        )}

        {!isLoading && !error && prs.length === 0 && isSearching && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Searching GitHub...
            </span>
          </div>
        )}

        {!isLoading && !error && prs.length > 0 && (
          <div className="py-1">
            {prs.map((pr, index) => (
              <PRItem
                key={pr.number}
                pr={pr}
                index={index}
                isSelected={index === selectedIndex}
                isCreating={creatingFromNumber === pr.number}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={(bg) => onSelectPR(pr, bg)}
                onInvestigate={(bg) => onInvestigatePR(pr, bg)}
              />
            ))}
            {isSearching && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="ml-1.5 text-xs text-muted-foreground">
                  Searching GitHub for more results...
                </span>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

interface IssueItemProps {
  issue: GitHubIssue
  index: number
  isSelected: boolean
  isCreating: boolean
  onMouseEnter: () => void
  onClick: (background: boolean) => void
  onInvestigate: (background: boolean) => void
}

function IssueItem({
  issue,
  index,
  isSelected,
  isCreating,
  onMouseEnter,
  onClick,
  onInvestigate,
}: IssueItemProps) {
  return (
    <div
      data-item-index={index}
      onMouseEnter={onMouseEnter}
      className={cn(
        'group w-full flex items-start gap-3 px-3 py-2.5 sm:py-2 text-left transition-colors',
        'hover:bg-accent',
        isSelected && 'bg-accent',
        isCreating && 'opacity-50'
      )}
    >
      {isCreating ? (
        <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <CircleDot
          className={cn(
            'h-4 w-4 mt-0.5 flex-shrink-0',
            issue.state === 'OPEN' ? 'text-green-500' : 'text-purple-500'
          )}
        />
      )}
      <button
        onClick={e => onClick(e.metaKey)}
        disabled={isCreating}
        className="flex-1 min-w-0 text-left focus:outline-none disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{issue.number}</span>
          <span className="text-sm font-medium truncate">{issue.title}</span>
          {isNewIssue(issue.created_at) && (
            <span className="shrink-0 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600 border border-green-500/20">
              New
            </span>
          )}
        </div>
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {issue.labels.slice(0, 3).map(label => (
              <span
                key={label.name}
                className="px-1.5 py-0.5 text-xs rounded-full"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                  border: `1px solid #${label.color}40`,
                }}
              >
                {label.name}
              </span>
            ))}
            {issue.labels.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{issue.labels.length - 3}
              </span>
            )}
          </div>
        )}
      </button>
      {/* Investigate button - always visible */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={e => {
              e.stopPropagation()
              onInvestigate(e.metaKey)
            }}
            disabled={isCreating}
            className="shrink-0 inline-flex items-center gap-0.5 rounded bg-black px-1 py-0.5 text-[10px] text-white transition-colors hover:bg-black/80 dark:bg-yellow-500/20 dark:text-yellow-400 dark:hover:bg-yellow-500/30 dark:hover:text-yellow-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Wand2 className="h-3 w-3" />
            <span>M</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>Create worktree and investigate issue</TooltipContent>
      </Tooltip>
    </div>
  )
}

interface PRItemProps {
  pr: GitHubPullRequest
  index: number
  isSelected: boolean
  isCreating: boolean
  onMouseEnter: () => void
  onClick: (background: boolean) => void
  onInvestigate: (background: boolean) => void
}

function PRItem({
  pr,
  index,
  isSelected,
  isCreating,
  onMouseEnter,
  onClick,
  onInvestigate,
}: PRItemProps) {
  return (
    <div
      data-item-index={index}
      onMouseEnter={onMouseEnter}
      className={cn(
        'group w-full flex items-start gap-3 px-3 py-2.5 sm:py-2 text-left transition-colors',
        'hover:bg-accent',
        isSelected && 'bg-accent',
        isCreating && 'opacity-50'
      )}
    >
      {isCreating ? (
        <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <GitPullRequest
          className={cn(
            'h-4 w-4 mt-0.5 flex-shrink-0',
            pr.state === 'OPEN'
              ? 'text-green-500'
              : pr.state === 'MERGED'
                ? 'text-purple-500'
                : 'text-red-500'
          )}
        />
      )}
      <button
        onClick={e => onClick(e.metaKey)}
        disabled={isCreating}
        className="flex-1 min-w-0 text-left focus:outline-none disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{pr.number}</span>
          <span className="text-sm font-medium truncate">{pr.title}</span>
          {pr.isDraft && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Draft
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">
            {pr.headRefName} → {pr.baseRefName}
          </span>
        </div>
        {pr.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {pr.labels.slice(0, 3).map(label => (
              <span
                key={label.name}
                className="px-1.5 py-0.5 text-xs rounded-full"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                  border: `1px solid #${label.color}40`,
                }}
              >
                {label.name}
              </span>
            ))}
            {pr.labels.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{pr.labels.length - 3}
              </span>
            )}
          </div>
        )}
      </button>
      {/* Investigate button - always visible */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={e => {
              e.stopPropagation()
              onInvestigate(e.metaKey)
            }}
            disabled={isCreating}
            className="shrink-0 inline-flex items-center gap-0.5 rounded bg-black px-1 py-0.5 text-[10px] text-white transition-colors hover:bg-black/80 dark:bg-yellow-500/20 dark:text-yellow-400 dark:hover:bg-yellow-500/30 dark:hover:text-yellow-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Wand2 className="h-3 w-3" />
            <span>M</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>Create worktree and investigate PR</TooltipContent>
      </Tooltip>
    </div>
  )
}

export interface BranchesTabProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  branches: string[]
  isLoading: boolean
  isRefetching: boolean
  error: Error | null
  onRefresh: () => void
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  onSelectBranch: (branchName: string, background?: boolean) => void
  creatingFromBranch: string | null
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

export function BranchesTab({
  searchQuery,
  setSearchQuery,
  branches,
  isLoading,
  isRefetching,
  error,
  onRefresh,
  selectedIndex,
  setSelectedIndex,
  onSelectBranch,
  creatingFromBranch,
  searchInputRef,
}: BranchesTabProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search and refresh */}
      <div className="p-3 border-b border-border">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search branches..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRefresh}
                disabled={isRefetching}
                className={cn(
                  'flex items-center justify-center h-8 w-8 rounded-md border border-border',
                  'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
                  'transition-colors',
                  isRefetching && 'opacity-50 cursor-not-allowed'
                )}
              >
                <RefreshCw
                  className={cn(
                    'h-4 w-4 text-muted-foreground',
                    isRefetching && 'animate-spin'
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh branches</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Branch list */}
      <ScrollArea className="flex-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading branches...
            </span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <AlertCircle className="h-5 w-5 text-destructive mb-2" />
            <span className="text-sm text-muted-foreground">
              {error.message || 'Failed to load branches'}
            </span>
          </div>
        )}

        {!isLoading && !error && branches.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">
              {searchQuery
                ? 'No branches match your search'
                : 'No branches found'}
            </span>
          </div>
        )}

        {!isLoading && !error && branches.length > 0 && (
          <div className="py-1">
            {branches.map((branch, index) => (
              <BranchItem
                key={branch}
                branch={branch}
                index={index}
                isSelected={index === selectedIndex}
                isCreating={creatingFromBranch === branch}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={(bg) => onSelectBranch(branch, bg)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

interface BranchItemProps {
  branch: string
  index: number
  isSelected: boolean
  isCreating: boolean
  onMouseEnter: () => void
  onClick: (background: boolean) => void
}

function BranchItem({
  branch,
  index,
  isSelected,
  isCreating,
  onMouseEnter,
  onClick,
}: BranchItemProps) {
  return (
    <button
      data-item-index={index}
      onMouseEnter={onMouseEnter}
      onClick={e => onClick(e.metaKey)}
      disabled={isCreating}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 sm:py-2 text-left transition-colors',
        'hover:bg-accent',
        isSelected && 'bg-accent',
        isCreating && 'opacity-50',
        'focus:outline-none disabled:cursor-not-allowed'
      )}
    >
      {isCreating ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <GitBranch className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      )}
      <span className="text-sm truncate">{branch}</span>
    </button>
  )
}

export default NewWorktreeModal
