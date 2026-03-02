import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type {
  LinearIssue,
  LinearIssueListResult,
  LinearTeam,
  LoadedLinearIssueContext,
} from '@/types/linear'
import { isTauri } from './projects'

/**
 * Check if an error is a Linear API key configuration error.
 */
export function isLinearAuthError(error: unknown): boolean {
  if (!error) return false
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  return (
    lower.includes('no linear api key') ||
    lower.includes('linear api key is invalid')
  )
}

// Query keys for Linear
export const linearQueryKeys = {
  all: ['linear'] as const,
  issues: (projectId: string) =>
    [...linearQueryKeys.all, 'issues', projectId] as const,
  issueSearch: (projectId: string, query: string) =>
    [...linearQueryKeys.all, 'issue-search', projectId, query] as const,
  loadedContexts: (sessionId: string) =>
    [...linearQueryKeys.all, 'loaded-contexts', sessionId] as const,
  teams: (projectId: string) =>
    [...linearQueryKeys.all, 'teams', projectId] as const,
}

/**
 * Hook to list Linear teams for a project
 */
export function useLinearTeams(
  projectId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: linearQueryKeys.teams(projectId ?? ''),
    queryFn: async (): Promise<LinearTeam[]> => {
      if (!isTauri() || !projectId) {
        return []
      }

      try {
        logger.debug('Fetching Linear teams', { projectId })
        const result = await invoke<LinearTeam[]>('list_linear_teams', {
          projectId,
        })
        logger.info('Linear teams loaded', { count: result.length })
        return result
      } catch (error) {
        logger.error('Failed to load Linear teams', { error, projectId })
        throw error
      }
    },
    enabled: (options?.enabled ?? true) && !!projectId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 1,
  })
}

/**
 * Hook to list Linear issues for a project
 */
export function useLinearIssues(
  projectId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: linearQueryKeys.issues(projectId ?? ''),
    queryFn: async (): Promise<LinearIssueListResult> => {
      if (!isTauri() || !projectId) {
        return { issues: [] }
      }

      try {
        logger.debug('Fetching Linear issues', { projectId })
        const result = await invoke<LinearIssueListResult>(
          'list_linear_issues',
          { projectId }
        )
        logger.info('Linear issues loaded', { count: result.issues.length })
        return result
      } catch (error) {
        logger.error('Failed to load Linear issues', { error, projectId })
        throw error
      }
    },
    enabled: (options?.enabled ?? true) && !!projectId,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    retry: 1,
  })
}

/**
 * Hook to search Linear issues
 */
export function useSearchLinearIssues(
  projectId: string | null,
  query: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: linearQueryKeys.issueSearch(projectId ?? '', query),
    queryFn: async (): Promise<LinearIssue[]> => {
      if (!isTauri() || !projectId || !query.trim()) {
        return []
      }

      try {
        logger.debug('Searching Linear issues', { projectId, query })
        const result = await invoke<LinearIssue[]>('search_linear_issues', {
          projectId,
          query,
        })
        logger.info('Linear issue search returned', { count: result.length })
        return result
      } catch (error) {
        logger.error('Failed to search Linear issues', { error, projectId })
        throw error
      }
    },
    enabled: (options?.enabled ?? true) && !!projectId && !!query.trim(),
    staleTime: 1000 * 60 * 1,
    gcTime: 1000 * 60 * 5,
    retry: 1,
  })
}

/**
 * Hook to list loaded Linear issue contexts for a session
 */
export function useLoadedLinearIssueContexts(
  sessionId: string | null,
  worktreeId: string | null,
  projectId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: linearQueryKeys.loadedContexts(sessionId ?? ''),
    queryFn: async (): Promise<LoadedLinearIssueContext[]> => {
      if (!isTauri() || !sessionId || !projectId) {
        return []
      }

      try {
        return await invoke<LoadedLinearIssueContext[]>(
          'list_loaded_linear_issue_contexts',
          { sessionId, worktreeId, projectId }
        )
      } catch (error) {
        logger.error('Failed to load Linear contexts', { error, sessionId })
        return []
      }
    },
    enabled: (options?.enabled ?? true) && !!sessionId && !!projectId,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    retry: 1,
  })
}

/**
 * Filter Linear issues by search query (client-side)
 */
export function filterLinearIssues(
  issues: LinearIssue[],
  query: string
): LinearIssue[] {
  if (!query.trim()) return issues

  const lowerQuery = query.toLowerCase().trim()

  return issues.filter(issue => {
    // Match by identifier (e.g., "ENG-123")
    if (issue.identifier.toLowerCase().includes(lowerQuery)) return true
    // Match by title
    if (issue.title.toLowerCase().includes(lowerQuery)) return true
    // Match by description
    if (issue.description?.toLowerCase().includes(lowerQuery)) return true

    return false
  })
}
