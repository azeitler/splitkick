import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type {
  GitHubIssue,
  GitHubIssueDetail,
  GitHubIssueListResult,
  GitHubPullRequest,
  GitHubPullRequestDetail,
  LoadedIssueContext,
  LoadedPullRequestContext,
  AttachedSavedContext,
  WorkflowRunsResult,
} from '@/types/github'
import { isTauri } from './projects'

/**
 * Check if an error is a GitHub CLI setup/authentication error.
 *
 * Matches:
 * - Auth errors: "GitHub CLI not authenticated. Run 'gh auth login' first."
 * - Not found: "Failed to run gh issue list: The system cannot find the file specified."
 * - Generic gh failures that indicate setup issues
 */
export function isGhAuthError(error: unknown): boolean {
  if (!error) return false
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  return (
    lower.includes('not authenticated') ||
    lower.includes('gh auth login') ||
    lower.includes('failed to run gh')
  )
}

// Query keys for GitHub
export const githubQueryKeys = {
  all: ['github'] as const,
  issues: (projectPath: string, state: string) =>
    [...githubQueryKeys.all, 'issues', projectPath, state] as const,
  issue: (projectPath: string, issueNumber: number) =>
    [...githubQueryKeys.all, 'issue', projectPath, issueNumber] as const,
  loadedContexts: (sessionId: string) =>
    [...githubQueryKeys.all, 'loaded-contexts', sessionId] as const,
  prs: (projectPath: string, state: string) =>
    [...githubQueryKeys.all, 'prs', projectPath, state] as const,
  pr: (projectPath: string, prNumber: number) =>
    [...githubQueryKeys.all, 'pr', projectPath, prNumber] as const,
  loadedPrContexts: (sessionId: string) =>
    [...githubQueryKeys.all, 'loaded-pr-contexts', sessionId] as const,
  attachedContexts: (sessionId: string) =>
    [...githubQueryKeys.all, 'attached-contexts', sessionId] as const,
  issueSearch: (projectPath: string, query: string) =>
    [...githubQueryKeys.all, 'issue-search', projectPath, query] as const,
  prSearch: (projectPath: string, query: string) =>
    [...githubQueryKeys.all, 'pr-search', projectPath, query] as const,
  workflowRuns: (projectPath: string, branch?: string) =>
    [...githubQueryKeys.all, 'workflow-runs', projectPath, branch ?? ''] as const,
}

/**
 * Hook to list GitHub issues for a project
 *
 * @param projectPath - Path to the git repository
 * @param state - Issue state: "open", "closed", or "all"
 */
export function useGitHubIssues(
  projectPath: string | null,
  state: 'open' | 'closed' | 'all' = 'open',
  options?: { enabled?: boolean; staleTime?: number }
) {
  return useQuery({
    queryKey: githubQueryKeys.issues(projectPath ?? '', state),
    queryFn: async (): Promise<GitHubIssueListResult> => {
      if (!isTauri() || !projectPath) {
        return { issues: [], totalCount: 0 }
      }

      try {
        logger.debug('Fetching GitHub issues', { projectPath, state })
        const result = await invoke<GitHubIssueListResult>('list_github_issues', {
          projectPath,
          state,
        })
        logger.info('GitHub issues loaded', { count: result.issues.length, totalCount: result.totalCount })
        return result
      } catch (error) {
        logger.error('Failed to load GitHub issues', { error, projectPath })
        throw error
      }
    },
    enabled: (options?.enabled ?? true) && !!projectPath,
    staleTime: options?.staleTime ?? 1000 * 60 * 2, // default 2 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 1, // Only retry once for API errors
  })
}

/**
 * Hook to get detailed information about a specific GitHub issue
 *
 * @param projectPath - Path to the git repository
 * @param issueNumber - Issue number to fetch
 */
export function useGitHubIssue(
  projectPath: string | null,
  issueNumber: number | null
) {
  return useQuery({
    queryKey: githubQueryKeys.issue(projectPath ?? '', issueNumber ?? 0),
    queryFn: async (): Promise<GitHubIssueDetail> => {
      if (!isTauri() || !projectPath || !issueNumber) {
        throw new Error('Missing required parameters')
      }

      try {
        logger.debug('Fetching GitHub issue details', {
          projectPath,
          issueNumber,
        })
        const issue = await invoke<GitHubIssueDetail>('get_github_issue', {
          projectPath,
          issueNumber,
        })
        logger.info('GitHub issue loaded', {
          number: issue.number,
          title: issue.title,
        })
        return issue
      } catch (error) {
        logger.error('Failed to load GitHub issue', {
          error,
          projectPath,
          issueNumber,
        })
        throw error
      }
    },
    enabled: !!projectPath && !!issueNumber,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 15, // 15 minutes
  })
}

const NEW_ISSUE_CUTOFF_MS = 24 * 60 * 60 * 1000

/** Check if an issue was created within the last 24 hours */
export function isNewIssue(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < NEW_ISSUE_CUTOFF_MS
}

/** Count issues created within the last 24 hours */
export function countNewIssues(issues: GitHubIssue[]): number {
  const cutoff = Date.now() - NEW_ISSUE_CUTOFF_MS
  return issues.filter(i => new Date(i.created_at).getTime() > cutoff).length
}

/**
 * Filter issues by search query (number, title, or body)
 *
 * Used for local filtering in the modal component
 */
export function filterIssues(
  issues: GitHubIssue[],
  query: string
): GitHubIssue[] {
  if (!query.trim()) {
    return issues
  }

  const lowerQuery = query.toLowerCase().trim()

  return issues.filter(issue => {
    // Match by issue number (e.g., "123" or "#123")
    const numberQuery = lowerQuery.replace(/^#/, '')
    if (issue.number.toString().includes(numberQuery)) {
      return true
    }

    // Match by title
    if (issue.title.toLowerCase().includes(lowerQuery)) {
      return true
    }

    // Match by body
    if (issue.body?.toLowerCase().includes(lowerQuery)) {
      return true
    }

    return false
  })
}

/**
 * Hook to search GitHub issues using GitHub's search API
 *
 * Queries GitHub directly via `gh issue list --search`, which finds
 * issues beyond the default list limit of 100.
 *
 * @param projectPath - Path to the git repository
 * @param query - Search query (should be debounced by caller)
 */
export function useSearchGitHubIssues(
  projectPath: string | null,
  query: string
) {
  return useQuery({
    queryKey: githubQueryKeys.issueSearch(projectPath ?? '', query),
    queryFn: async (): Promise<GitHubIssue[]> => {
      if (!isTauri() || !projectPath || !query) {
        return []
      }

      try {
        logger.debug('Searching GitHub issues', { projectPath, query })
        const issues = await invoke<GitHubIssue[]>('search_github_issues', {
          projectPath,
          query,
        })
        logger.info('GitHub issue search results', {
          count: issues.length,
          query,
        })
        return issues
      } catch (error) {
        logger.error('Failed to search GitHub issues', {
          error,
          projectPath,
          query,
        })
        throw error
      }
    },
    enabled: !!projectPath && query.length >= 2,
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    retry: 0,
  })
}

/**
 * Hook to list loaded issue contexts for a session
 *
 * @param sessionId - The session ID
 */
export function useLoadedIssueContexts(
  sessionId: string | null,
  worktreeId?: string | null
) {
  return useQuery({
    queryKey: githubQueryKeys.loadedContexts(sessionId ?? ''),
    queryFn: async (): Promise<LoadedIssueContext[]> => {
      if (!isTauri() || !sessionId) {
        return []
      }

      try {
        logger.debug('Fetching loaded issue contexts', { sessionId })
        const contexts = await invoke<LoadedIssueContext[]>(
          'list_loaded_issue_contexts',
          {
            sessionId,
            worktreeId: worktreeId ?? undefined,
          }
        )
        logger.info('Loaded issue contexts fetched', { count: contexts.length })
        return contexts
      } catch (error) {
        logger.error('Failed to load issue contexts', { error, sessionId })
        throw error
      }
    },
    enabled: !!sessionId,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Load issue context for a session (fetch from GitHub and save)
 */
export async function loadIssueContext(
  sessionId: string,
  issueNumber: number,
  projectPath: string
): Promise<LoadedIssueContext> {
  return invoke<LoadedIssueContext>('load_issue_context', {
    sessionId,
    issueNumber,
    projectPath,
  })
}

/**
 * Remove a loaded issue context from a session
 */
export async function removeIssueContext(
  sessionId: string,
  issueNumber: number,
  projectPath: string
): Promise<void> {
  return invoke('remove_issue_context', {
    sessionId,
    issueNumber,
    projectPath,
  })
}

// =============================================================================
// GitHub Pull Request Hooks and Functions
// =============================================================================

/**
 * Hook to list GitHub pull requests for a project
 *
 * @param projectPath - Path to the git repository
 * @param state - PR state: "open", "closed", "merged", or "all"
 */
export function useGitHubPRs(
  projectPath: string | null,
  state: 'open' | 'closed' | 'merged' | 'all' = 'open',
  options?: { enabled?: boolean; staleTime?: number }
) {
  return useQuery({
    queryKey: githubQueryKeys.prs(projectPath ?? '', state),
    queryFn: async (): Promise<GitHubPullRequest[]> => {
      if (!isTauri() || !projectPath) {
        return []
      }

      try {
        logger.debug('Fetching GitHub PRs', { projectPath, state })
        const prs = await invoke<GitHubPullRequest[]>('list_github_prs', {
          projectPath,
          state,
        })
        logger.info('GitHub PRs loaded', { count: prs.length })
        return prs
      } catch (error) {
        logger.error('Failed to load GitHub PRs', { error, projectPath })
        throw error
      }
    },
    enabled: (options?.enabled ?? true) && !!projectPath,
    staleTime: options?.staleTime ?? 1000 * 60 * 2, // default 2 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 1, // Only retry once for API errors
  })
}

/**
 * Hook to get detailed information about a specific GitHub PR
 *
 * @param projectPath - Path to the git repository
 * @param prNumber - PR number to fetch
 */
export function useGitHubPR(
  projectPath: string | null,
  prNumber: number | null
) {
  return useQuery({
    queryKey: githubQueryKeys.pr(projectPath ?? '', prNumber ?? 0),
    queryFn: async (): Promise<GitHubPullRequestDetail> => {
      if (!isTauri() || !projectPath || !prNumber) {
        throw new Error('Missing required parameters')
      }

      try {
        logger.debug('Fetching GitHub PR details', { projectPath, prNumber })
        const pr = await invoke<GitHubPullRequestDetail>('get_github_pr', {
          projectPath,
          prNumber,
        })
        logger.info('GitHub PR loaded', { number: pr.number, title: pr.title })
        return pr
      } catch (error) {
        logger.error('Failed to load GitHub PR', {
          error,
          projectPath,
          prNumber,
        })
        throw error
      }
    },
    enabled: !!projectPath && !!prNumber,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 15, // 15 minutes
  })
}

/**
 * Hook to list loaded PR contexts for a session
 *
 * @param sessionId - The session ID
 */
export function useLoadedPRContexts(
  sessionId: string | null,
  worktreeId?: string | null
) {
  return useQuery({
    queryKey: githubQueryKeys.loadedPrContexts(sessionId ?? ''),
    queryFn: async (): Promise<LoadedPullRequestContext[]> => {
      if (!isTauri() || !sessionId) {
        return []
      }

      try {
        logger.debug('Fetching loaded PR contexts', { sessionId })
        const contexts = await invoke<LoadedPullRequestContext[]>(
          'list_loaded_pr_contexts',
          {
            sessionId,
            worktreeId: worktreeId ?? undefined,
          }
        )
        logger.info('Loaded PR contexts fetched', { count: contexts.length })
        return contexts
      } catch (error) {
        logger.error('Failed to load PR contexts', { error, sessionId })
        throw error
      }
    },
    enabled: !!sessionId,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Load PR context for a session (fetch from GitHub and save)
 */
export async function loadPRContext(
  sessionId: string,
  prNumber: number,
  projectPath: string
): Promise<LoadedPullRequestContext> {
  return invoke<LoadedPullRequestContext>('load_pr_context', {
    sessionId,
    prNumber,
    projectPath,
  })
}

/**
 * Remove a loaded PR context from a session
 */
export async function removePRContext(
  sessionId: string,
  prNumber: number,
  projectPath: string
): Promise<void> {
  return invoke('remove_pr_context', {
    sessionId,
    prNumber,
    projectPath,
  })
}

/**
 * Get the content of a loaded issue context file
 */
export async function getIssueContextContent(
  sessionId: string,
  issueNumber: number,
  projectPath: string
): Promise<string> {
  return invoke<string>('get_issue_context_content', {
    sessionId,
    issueNumber,
    projectPath,
  })
}

/**
 * Get the content of a loaded PR context file
 */
export async function getPRContextContent(
  sessionId: string,
  prNumber: number,
  projectPath: string
): Promise<string> {
  return invoke<string>('get_pr_context_content', {
    sessionId,
    prNumber,
    projectPath,
  })
}

/**
 * Filter PRs by search query (number, title, or body)
 *
 * Used for local filtering in the modal component
 */
export function filterPRs(
  prs: GitHubPullRequest[],
  query: string
): GitHubPullRequest[] {
  if (!query.trim()) {
    return prs
  }

  const lowerQuery = query.toLowerCase().trim()

  return prs.filter(pr => {
    // Match by PR number (e.g., "123" or "#123")
    const numberQuery = lowerQuery.replace(/^#/, '')
    if (pr.number.toString().includes(numberQuery)) {
      return true
    }

    // Match by title
    if (pr.title.toLowerCase().includes(lowerQuery)) {
      return true
    }

    // Match by body
    if (pr.body?.toLowerCase().includes(lowerQuery)) {
      return true
    }

    // Match by branch name
    if (pr.headRefName.toLowerCase().includes(lowerQuery)) {
      return true
    }

    return false
  })
}

/**
 * Hook to search GitHub PRs using GitHub's search API
 *
 * Queries GitHub directly via `gh pr list --search`, which finds
 * PRs beyond the default list limit of 100.
 *
 * @param projectPath - Path to the git repository
 * @param query - Search query (should be debounced by caller)
 */
export function useSearchGitHubPRs(projectPath: string | null, query: string) {
  return useQuery({
    queryKey: githubQueryKeys.prSearch(projectPath ?? '', query),
    queryFn: async (): Promise<GitHubPullRequest[]> => {
      if (!isTauri() || !projectPath || !query) {
        return []
      }

      try {
        logger.debug('Searching GitHub PRs', { projectPath, query })
        const prs = await invoke<GitHubPullRequest[]>('search_github_prs', {
          projectPath,
          query,
        })
        logger.info('GitHub PR search results', { count: prs.length, query })
        return prs
      } catch (error) {
        logger.error('Failed to search GitHub PRs', {
          error,
          projectPath,
          query,
        })
        throw error
      }
    },
    enabled: !!projectPath && query.length >= 2,
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    retry: 0,
  })
}

/**
 * Merge local-filtered results with remote search results, deduplicating by number.
 * Local results appear first, remote-only results are appended.
 */
export function mergeWithSearchResults<T extends { number: number }>(
  localResults: T[],
  searchResults: T[] | undefined
): T[] {
  if (!searchResults?.length) return localResults

  const localNumbers = new Set(localResults.map(item => item.number))
  const remoteOnly = searchResults.filter(
    item => !localNumbers.has(item.number)
  )

  if (remoteOnly.length === 0) return localResults
  return [...localResults, ...remoteOnly]
}

// =============================================================================
// GitHub Actions Workflow Runs
// =============================================================================

/**
 * Hook to list GitHub Actions workflow runs for a project
 *
 * @param projectPath - Path to the git repository
 * @param branch - Optional branch name to filter runs (for PR/worktree-specific views)
 */
export function useWorkflowRuns(
  projectPath: string | null,
  branch?: string,
  options?: { enabled?: boolean; staleTime?: number }
) {
  return useQuery({
    queryKey: githubQueryKeys.workflowRuns(projectPath ?? '', branch),
    queryFn: async (): Promise<WorkflowRunsResult> => {
      if (!isTauri() || !projectPath) {
        return { runs: [], failedCount: 0 }
      }

      try {
        logger.debug('Fetching workflow runs', { projectPath, branch })
        const result = await invoke<WorkflowRunsResult>('list_workflow_runs', {
          projectPath,
          branch: branch ?? null,
        })
        logger.info('Workflow runs loaded', {
          count: result.runs.length,
          failedCount: result.failedCount,
        })
        return result
      } catch (error) {
        logger.error('Failed to load workflow runs', { error, projectPath })
        throw error
      }
    },
    enabled: (options?.enabled ?? true) && !!projectPath,
    staleTime: options?.staleTime ?? 1000 * 60 * 3, // 3 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 1,
  })
}

// =============================================================================
// Attached Saved Context Hooks and Functions
// =============================================================================

/**
 * Hook to list attached saved contexts for a session
 *
 * @param sessionId - The session ID
 */
export function useAttachedSavedContexts(sessionId: string | null) {
  return useQuery({
    queryKey: githubQueryKeys.attachedContexts(sessionId ?? ''),
    queryFn: async (): Promise<AttachedSavedContext[]> => {
      if (!isTauri() || !sessionId) {
        return []
      }

      try {
        logger.debug('Fetching attached saved contexts', { sessionId })
        const contexts = await invoke<AttachedSavedContext[]>(
          'list_attached_saved_contexts',
          {
            sessionId,
          }
        )
        logger.info('Attached saved contexts fetched', {
          count: contexts.length,
        })
        return contexts
      } catch (error) {
        logger.error('Failed to load attached saved contexts', {
          error,
          sessionId,
        })
        throw error
      }
    },
    enabled: !!sessionId,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Attach a saved context to a session (copy file to session-specific location)
 */
export async function attachSavedContext(
  sessionId: string,
  sourcePath: string,
  slug: string
): Promise<AttachedSavedContext> {
  return invoke<AttachedSavedContext>('attach_saved_context', {
    sessionId,
    sourcePath,
    slug,
  })
}

/**
 * Remove an attached saved context from a session
 */
export async function removeSavedContext(
  sessionId: string,
  slug: string
): Promise<void> {
  return invoke('remove_saved_context', {
    sessionId,
    slug,
  })
}

/**
 * Get the content of an attached saved context file
 */
export async function getSavedContextContent(
  sessionId: string,
  slug: string
): Promise<string> {
  return invoke<string>('get_saved_context_content', {
    sessionId,
    slug,
  })
}
