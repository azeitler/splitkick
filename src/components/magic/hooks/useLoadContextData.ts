import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { toast } from 'sonner'
import { useAllSessions } from '@/services/chat'
import {
  useGitHubIssues,
  useGitHubPRs,
  useSearchGitHubIssues,
  useSearchGitHubPRs,
  useGetGitHubIssueByNumber,
  useGetGitHubPRByNumber,
  useLoadedIssueContexts,
  useLoadedPRContexts,
  useAttachedSavedContexts,
  filterIssues,
  filterPRs,
  mergeWithSearchResults,
  prependExactMatch,
} from '@/services/github'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { SavedContextsResponse } from '@/types/chat'

interface UseLoadContextDataOptions {
  open: boolean
  worktreePath: string | null
  activeSessionId: string | null
  searchQuery: string
  includeClosed: boolean
}

export function useLoadContextData({
  open,
  worktreePath,
  activeSessionId,
  searchQuery,
  includeClosed,
}: UseLoadContextDataOptions) {
  const queryClient = useQueryClient()

  // Issue contexts for this session
  const {
    data: loadedIssueContexts,
    isLoading: isLoadingIssueContexts,
    refetch: refetchIssueContexts,
  } = useLoadedIssueContexts(activeSessionId)

  // PR contexts for this session
  const {
    data: loadedPRContexts,
    isLoading: isLoadingPRContexts,
    refetch: refetchPRContexts,
  } = useLoadedPRContexts(activeSessionId)

  // Attached saved contexts for this session
  const {
    data: attachedSavedContexts,
    isLoading: isLoadingAttachedContexts,
    refetch: refetchAttachedContexts,
  } = useAttachedSavedContexts(activeSessionId)

  // GitHub issues query
  const issueState = includeClosed ? 'all' : 'open'
  const {
    data: issueResult,
    isLoading: isLoadingIssues,
    isFetching: isRefetchingIssues,
    error: issuesError,
    refetch: refetchIssues,
  } = useGitHubIssues(worktreePath, issueState)
  const issues = issueResult?.issues

  // GitHub PRs query
  const prState = includeClosed ? 'all' : 'open'
  const {
    data: prs,
    isLoading: isLoadingPRs,
    isFetching: isRefetchingPRs,
    error: prsError,
    refetch: refetchPRs,
  } = useGitHubPRs(worktreePath, prState)

  // Fetch saved contexts
  const {
    data: contextsData,
    isLoading: isLoadingContexts,
    error: contextsError,
    refetch: refetchContexts,
  } = useQuery({
    queryKey: ['session-context'],
    queryFn: () => invoke<SavedContextsResponse>('list_saved_contexts'),
    enabled: open,
    staleTime: 1000 * 60 * 5,
  })

  // Fetch all sessions across all worktrees
  const { data: allSessionsData, isLoading: isLoadingSessions } =
    useAllSessions(open)

  // Debounced search query for GitHub API search
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)

  // GitHub search queries (triggered when local filter may miss results)
  const { data: searchedIssues, isFetching: isSearchingIssues } =
    useSearchGitHubIssues(worktreePath, debouncedSearchQuery)

  const { data: searchedPRs, isFetching: isSearchingPRs } =
    useSearchGitHubPRs(worktreePath, debouncedSearchQuery)

  // Exact number lookups (finds any issue/PR regardless of age or state)
  const { data: exactIssue } = useGetGitHubIssueByNumber(
    worktreePath,
    debouncedSearchQuery
  )
  const { data: exactPR } = useGetGitHubPRByNumber(
    worktreePath,
    debouncedSearchQuery
  )

  // Filter issues locally, merge with search results, exclude already loaded ones
  const filteredIssues = useMemo(() => {
    const loadedNumbers = new Set(loadedIssueContexts?.map(c => c.number) ?? [])
    const localFiltered = filterIssues(issues ?? [], searchQuery)
    const merged = mergeWithSearchResults(localFiltered, searchedIssues)
    const withExact = prependExactMatch(merged, exactIssue)
    return withExact.filter(issue => !loadedNumbers.has(issue.number))
  }, [issues, searchQuery, searchedIssues, loadedIssueContexts, exactIssue])

  // Filter PRs locally, merge with search results, exclude already loaded ones
  const filteredPRs = useMemo(() => {
    const loadedNumbers = new Set(loadedPRContexts?.map(c => c.number) ?? [])
    const localFiltered = filterPRs(prs ?? [], searchQuery)
    const merged = mergeWithSearchResults(localFiltered, searchedPRs)
    const withExact = prependExactMatch(merged, exactPR)
    return withExact.filter(pr => !loadedNumbers.has(pr.number))
  }, [prs, searchQuery, searchedPRs, loadedPRContexts, exactPR])

  // Filter contexts by search query, excluding already attached ones
  const filteredContexts = useMemo(() => {
    if (!contextsData?.contexts) return []

    const attachedSlugs = new Set(attachedSavedContexts?.map(c => c.slug) ?? [])
    const filtered = contextsData.contexts.filter(
      ctx => !attachedSlugs.has(ctx.slug)
    )

    if (!searchQuery) return filtered

    const query = searchQuery.toLowerCase()
    return filtered.filter(
      ctx =>
        ctx.slug.toLowerCase().includes(query) ||
        ctx.project_name.toLowerCase().includes(query) ||
        (ctx.name && ctx.name.toLowerCase().includes(query))
    )
  }, [contextsData, searchQuery, attachedSavedContexts])

  // Filter sessions (exclude current session, apply search, group by project/worktree)
  const filteredEntries = useMemo(() => {
    if (!allSessionsData?.entries) return []

    return allSessionsData.entries
      .map(entry => {
        const filteredSessions = entry.sessions
          .filter(s => s.id !== activeSessionId)
          .filter(s => {
            if (!searchQuery) return true
            const query = searchQuery.toLowerCase()
            return (
              s.name.toLowerCase().includes(query) ||
              entry.project_name.toLowerCase().includes(query) ||
              entry.worktree_name.toLowerCase().includes(query) ||
              s.messages.some(m => m.content.toLowerCase().includes(query))
            )
          })

        return { ...entry, sessions: filteredSessions }
      })
      .filter(entry => entry.sessions.length > 0)
  }, [allSessionsData, searchQuery, activeSessionId])

  // Mutation for renaming contexts
  const renameMutation = useMutation({
    mutationFn: async ({
      filename,
      newName,
    }: {
      filename: string
      newName: string
    }) => {
      await invoke('rename_saved_context', { filename, newName })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-context'] })
    },
    onError: error => {
      toast.error(`Failed to rename context: ${error}`)
    },
  })

  return {
    // Loaded/attached data
    loadedIssueContexts,
    isLoadingIssueContexts,
    refetchIssueContexts,
    loadedPRContexts,
    isLoadingPRContexts,
    refetchPRContexts,
    attachedSavedContexts,
    isLoadingAttachedContexts,
    refetchAttachedContexts,

    // GitHub data states
    isLoadingIssues,
    isRefetchingIssues,
    isSearchingIssues,
    issuesError,
    refetchIssues,
    isLoadingPRs,
    isRefetchingPRs,
    isSearchingPRs,
    prsError,
    refetchPRs,

    // Contexts/sessions states
    isLoadingContexts,
    isLoadingSessions,
    contextsError,
    refetchContexts,

    // Filtered data
    filteredIssues,
    filteredPRs,
    filteredContexts,
    filteredEntries,

    // Mutation
    renameMutation,

    // Derived booleans
    hasLoadedIssueContexts: (loadedIssueContexts?.length ?? 0) > 0,
    hasLoadedPRContexts: (loadedPRContexts?.length ?? 0) > 0,
    hasAttachedContexts: (attachedSavedContexts?.length ?? 0) > 0,
    hasContexts: filteredContexts.length > 0,
    hasSessions: filteredEntries.length > 0,
  }
}
