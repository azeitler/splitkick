import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useProjectsStore } from '@/store/projects-store'
import {
  useGitHubIssues,
  useGitHubPRs,
  useSearchGitHubIssues,
  useSearchGitHubPRs,
  useGetGitHubIssueByNumber,
  useGetGitHubPRByNumber,
  filterIssues,
  filterPRs,
  mergeWithSearchResults,
  prependExactMatch,
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
} from '@/services/projects'
import { isBaseSession } from '@/types/projects'

export function useNewWorktreeData(
  searchQuery: string,
  includeClosed: boolean
) {
  const queryClient = useQueryClient()
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)

  // Project data
  const { data: projects } = useProjects()
  const selectedProject = useMemo(
    () => projects?.find(p => p.id === selectedProjectId),
    [projects, selectedProjectId]
  )

  // Worktrees & base session
  const { data: worktrees } = useWorktrees(selectedProjectId)
  const hasBaseSession = useMemo(
    () => worktrees?.some(w => isBaseSession(w)) ?? false,
    [worktrees]
  )
  const baseSession = useMemo(
    () => worktrees?.find(w => isBaseSession(w)),
    [worktrees]
  )

  // GitHub issues
  const issueState = includeClosed ? 'all' : 'open'
  const {
    data: issueResult,
    isLoading: isLoadingIssues,
    isFetching: isRefetchingIssues,
    error: issuesError,
    refetch: refetchIssues,
  } = useGitHubIssues(selectedProject?.path ?? null, issueState)
  const issues = issueResult?.issues

  // GitHub PRs
  const prState = includeClosed ? 'all' : 'open'
  const {
    data: prs,
    isLoading: isLoadingPRs,
    isFetching: isRefetchingPRs,
    error: prsError,
    refetch: refetchPRs,
  } = useGitHubPRs(selectedProject?.path ?? null, prState)

  // Debounced search for GitHub API
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)

  const { data: searchedIssues, isFetching: isSearchingIssues } =
    useSearchGitHubIssues(selectedProject?.path ?? null, debouncedSearchQuery)

  const { data: searchedPRs, isFetching: isSearchingPRs } = useSearchGitHubPRs(
    selectedProject?.path ?? null,
    debouncedSearchQuery
  )

  // Exact number lookups (finds any issue/PR regardless of age or state)
  const { data: exactIssue } = useGetGitHubIssueByNumber(
    selectedProject?.path ?? null,
    debouncedSearchQuery
  )
  const { data: exactPR } = useGetGitHubPRByNumber(
    selectedProject?.path ?? null,
    debouncedSearchQuery
  )

  // Filtered issues
  const filteredIssues = useMemo(
    () =>
      prependExactMatch(
        mergeWithSearchResults(
          filterIssues(issues ?? [], searchQuery),
          searchedIssues
        ),
        exactIssue
      ),
    [issues, searchQuery, searchedIssues, exactIssue]
  )

  // Filtered PRs
  const filteredPRs = useMemo(
    () =>
      prependExactMatch(
        mergeWithSearchResults(filterPRs(prs ?? [], searchQuery), searchedPRs),
        exactPR
      ),
    [prs, searchQuery, searchedPRs, exactPR]
  )

  // Branches
  const {
    data: branches,
    isLoading: isLoadingBranches,
    isFetching: isRefetchingBranches,
    error: branchesError,
    refetch: refetchBranches,
  } = useProjectBranches(selectedProjectId)

  const filteredBranches = useMemo(() => {
    if (!branches) return []
    const baseBranch = selectedProject?.default_branch
    const filtered = branches.filter(b => b !== baseBranch)
    if (!searchQuery) return filtered
    const q = searchQuery.toLowerCase()
    return filtered.filter(b => b.toLowerCase().includes(q))
  }, [branches, searchQuery, selectedProject?.default_branch])

  // Jean config
  const { data: jeanConfig } = useJeanConfig(selectedProject?.path ?? null)

  // Mutations
  const createWorktree = useCreateWorktree()
  const createBaseSession = useCreateBaseSession()
  const createWorktreeFromBranch = useCreateWorktreeFromExistingBranch()

  return {
    queryClient,
    selectedProjectId,
    selectedProject,
    hasBaseSession,
    baseSession,
    jeanConfig,

    // Issues
    filteredIssues,
    isLoadingIssues,
    isRefetchingIssues,
    isSearchingIssues,
    issuesError,
    refetchIssues,

    // PRs
    filteredPRs,
    isLoadingPRs,
    isRefetchingPRs,
    isSearchingPRs,
    prsError,
    refetchPRs,

    // Branches
    filteredBranches,
    isLoadingBranches,
    isRefetchingBranches,
    branchesError,
    refetchBranches,

    // Mutations
    createWorktree,
    createBaseSession,
    createWorktreeFromBranch,
  }
}
