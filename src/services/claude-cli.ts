/**
 * Claude CLI management service
 *
 * Provides TanStack Query hooks for checking, installing, and managing
 * the embedded Claude CLI binary.
 */

import { getUsageRefetchInterval, getUsageStaleTime } from '@/lib/usage-timing'
import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { invoke, useWsConnectionStatus } from '@/lib/transport'
import { listen } from '@/lib/transport'
import { toast } from 'sonner'
import { useCallback, useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import type {
  ClaudeCliStatus,
  ClaudeAuthStatus,
  ReleaseInfo,
  InstallProgress,
  ClaudeUsageSnapshot,
} from '@/types/claude-cli'

import { hasBackendTransport } from '@/lib/environment'
import { activeClaudeAccountId } from '@/lib/claude-accounts'
import { usePreferences } from '@/services/preferences'
import { preserveQueryCacheOnError } from '@/lib/query-error'

const isTauri = hasBackendTransport

// Query keys for Claude CLI
export const claudeCliQueryKeys = {
  all: ['claude-cli'] as const,
  status: () => [...claudeCliQueryKeys.all, 'status'] as const,
  /** Auth of the active account (the one new runs use). */
  auth: () => [...claudeCliQueryKeys.all, 'auth'] as const,
  /** Auth of one account; under `auth()` so its invalidation reaches it. */
  accountAuth: (accountId: string) =>
    [...claudeCliQueryKeys.auth(), 'account', accountId] as const,
  usage: () => [...claudeCliQueryKeys.all, 'usage'] as const,
  accountUsage: (accountId: string) =>
    [...claudeCliQueryKeys.usage(), accountId] as const,
  versions: () => [...claudeCliQueryKeys.all, 'versions'] as const,
}

/**
 * Hook to detect Claude CLI in system PATH
 */
export function useClaudePathDetection(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...claudeCliQueryKeys.all, 'path-detection'],
    queryFn: async (): Promise<{
      found: boolean
      path: string | null
      version: string | null
      package_manager: string | null
    }> => {
      if (!isTauri()) {
        return {
          found: false,
          path: null,
          version: null,
          package_manager: null,
        }
      }
      try {
        const result = await invoke<{
          found: boolean
          path: string | null
          version: string | null
          package_manager: string | null
        }>('detect_claude_in_path')
        console.debug('[ONBOARDING:SVC] claude path detection:', result)
        return result
      } catch (err) {
        console.debug('[ONBOARDING:SVC] claude path detection failed:', err)
        return {
          found: false,
          path: null,
          version: null,
          package_manager: null,
        }
      }
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 30, // 30 min cache
    gcTime: 1000 * 60 * 60,
  })
}

/**
 * Hook to check if Claude CLI is installed and get its status
 */
export function useClaudeCliStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: claudeCliQueryKeys.status(),
    queryFn: async (): Promise<ClaudeCliStatus> => {
      if (!isTauri()) {
        logger.debug('Not in Tauri context, returning mock CLI status')
        return {
          installed: false,
          version: null,
          path: null,
          supports_auth_command: false,
        }
      }

      try {
        console.debug('[ONBOARDING:SVC] claude: checking installed status...')
        const status = await invoke<ClaudeCliStatus>(
          'check_claude_cli_installed'
        )
        console.debug('[ONBOARDING:SVC] claude: status =', status)
        return status
      } catch (error) {
        logger.error('Failed to check Claude CLI status', { error })
        // Rethrow: a failed check is unknown, not a negative result. Keeps the
        // last good result and stops a timeout from opening onboarding.
        return preserveQueryCacheOnError(error)
      }
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    refetchInterval: 1000 * 60 * 60, // Re-check every hour
  })
}

/**
 * Hook to check if Claude CLI is authenticated
 */
export function useClaudeCliAuth(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: claudeCliQueryKeys.auth(),
    queryFn: async (): Promise<ClaudeAuthStatus> => {
      if (!isTauri()) {
        logger.debug('Not in Tauri context, returning mock auth status')
        return { authenticated: false, error: 'Not in Tauri context' }
      }

      try {
        console.debug('[ONBOARDING:SVC] claude: checking auth status...')
        const status = await invoke<ClaudeAuthStatus>('check_claude_cli_auth')
        console.debug('[ONBOARDING:SVC] claude: auth =', status)
        return status
      } catch (error) {
        logger.error('Failed to check Claude CLI auth', { error })
        // Rethrow: a failed check is unknown, not a negative result. Keeps the
        // last good result and stops a timeout from opening onboarding.
        return preserveQueryCacheOnError(error)
      }
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
  })
}

/**
 * Auth status of one Claude account (`root` or an account id).
 */
export function useClaudeAccountAuth(
  accountId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: claudeCliQueryKeys.accountAuth(accountId),
    queryFn: async (): Promise<ClaudeAuthStatus> => {
      if (!isTauri()) {
        return { authenticated: false, error: 'Not in Tauri context' }
      }
      return invoke<ClaudeAuthStatus>('check_claude_cli_auth', { accountId })
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })
}

/** How often a usage card checks again while its token is renewed (#134). */
export const CLAUDE_USAGE_RENEW_POLL_MS = 3000

/**
 * True while the Claude CLI renews an idle account's token (#134): stored
 * figures with `renewing`, or the "Updating usage…" message when none are
 * stored yet.
 */
export function isClaudeUsageRenewing(
  data: ClaudeUsageSnapshot | undefined,
  error: unknown
): boolean {
  if (data?.renewing) return true
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : ''
  return message.startsWith('Updating')
}

/**
 * Usage query of one account. Every account polls on the usage-timing rules
 * (5 minutes, stale backoff) under its own key, so accounts do not share or
 * multiply a request.
 */
function claudeUsageQuery(accountId: string, enabled: boolean) {
  return {
    queryKey: claudeCliQueryKeys.accountUsage(accountId),
    queryFn: async (): Promise<ClaudeUsageSnapshot> => {
      if (!isTauri()) {
        throw new Error('Claude usage is only available in Tauri context')
      }
      return invoke<ClaudeUsageSnapshot>('get_claude_usage', { accountId })
    },
    enabled,
    staleTime: (query: { state: { data?: ClaudeUsageSnapshot } }) =>
      getUsageStaleTime(query.state.data),
    gcTime: 1000 * 60 * 10,
    refetchInterval: (query: {
      state: { data?: ClaudeUsageSnapshot; error?: unknown }
    }) =>
      isClaudeUsageRenewing(query.state.data, query.state.error)
        ? CLAUDE_USAGE_RENEW_POLL_MS
        : getUsageRefetchInterval(query.state.data),
  }
}

/**
 * Hook to fetch current Claude usage. Without `accountId` it follows the
 * active account, the one new Claude runs use.
 */
export function useClaudeUsage(options?: {
  enabled?: boolean
  accountId?: string
}) {
  const { data: preferences } = usePreferences()
  const accountId = options?.accountId ?? activeClaudeAccountId(preferences)
  return useQuery(claudeUsageQuery(accountId, options?.enabled ?? true))
}

/** Usage of several accounts at once, one query per account. */
export function useClaudeAccountsUsage(
  accountIds: string[],
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true
  return useQueries({
    queries: accountIds.map(id => claudeUsageQuery(id, enabled)),
  })
}

/**
 * Hook to fetch available Claude CLI versions from GitHub
 */
export function useAvailableCliVersions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: claudeCliQueryKeys.versions(),
    queryFn: async (): Promise<ReleaseInfo[]> => {
      if (!isTauri()) {
        logger.debug('Not in Tauri context, returning empty versions list')
        return []
      }

      try {
        logger.debug('Fetching available Claude CLI versions')
        // Transform snake_case from Rust to camelCase
        const versions = await invoke<
          {
            version: string
            tag_name: string
            published_at: string
            prerelease: boolean
          }[]
        >('get_available_cli_versions')

        return versions.map(v => ({
          version: v.version,
          tagName: v.tag_name,
          publishedAt: v.published_at,
          prerelease: v.prerelease,
        }))
      } catch (error) {
        logger.error('Failed to fetch CLI versions', { error })
        throw error
      }
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 15, // Cache for 15 minutes to avoid rate limiting
    gcTime: 1000 * 60 * 30, // 30 minutes
    refetchInterval: 1000 * 60 * 60, // Re-check every hour
  })
}

/**
 * Hook to install Claude CLI
 */
export function useInstallClaudeCli() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (version?: string) => {
      logger.info('Installing Claude CLI', { version })
      await invoke('install_claude_cli', { version: version ?? null })
    },
    // Disable retry - installation should not be retried automatically
    retry: false,
    onSuccess: () => {
      // Invalidate status to refetch
      queryClient.invalidateQueries({ queryKey: claudeCliQueryKeys.status() })
      logger.info('Claude CLI installed successfully')
      toast.success('Claude CLI installed successfully')
    },
    onError: error => {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to install Claude CLI', { error })
      toast.error('Failed to install Claude CLI', { description: message })
    },
  })
}

/**
 * Hook to listen for installation progress events
 * Returns [progress, resetProgress] tuple to allow resetting state before new install
 */
export function useInstallProgress(): [InstallProgress | null, () => void] {
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const wsConnected = useWsConnectionStatus()

  const resetProgress = useCallback(() => {
    setProgress(null)
  }, [])

  useEffect(() => {
    if (!isTauri()) return

    let unlistenFn: (() => void) | null = null
    const listenerId = Math.random().toString(36).substring(7)

    const setupListener = async () => {
      try {
        logger.info('[useInstallProgress] Setting up listener', { listenerId })
        unlistenFn = await listen<InstallProgress>(
          'claude-cli:install-progress',
          event => {
            logger.info('[useInstallProgress] Received progress event', {
              listenerId,
              stage: event.payload.stage,
              message: event.payload.message,
              percent: event.payload.percent,
            })
            setProgress(event.payload)
          }
        )
      } catch (error) {
        logger.error('[useInstallProgress] Failed to setup listener', {
          listenerId,
          error,
        })
      }
    }

    setupListener()

    return () => {
      logger.info('[useInstallProgress] Cleaning up listener', { listenerId })
      if (unlistenFn) {
        unlistenFn()
      }
    }
  }, [wsConnected])

  return [progress, resetProgress]
}

/**
 * Combined hook for CLI setup flow
 */
function checkManualVersion(version: string) {
  return invoke<boolean>('check_claude_cli_version_exists', { version })
}

export function useClaudeCliSetup() {
  const status = useClaudeCliStatus()
  const versions = useAvailableCliVersions()
  const installMutation = useInstallClaudeCli()
  const [progress, resetProgress] = useInstallProgress()

  const needsSetup = !status.isLoading && !status.data?.installed

  // Wrapper to support install with options (e.g., onSuccess callback)
  const install = (
    version: string,
    options?: { onSuccess?: () => void; onError?: (error: Error) => void }
  ) => {
    logger.info('[useClaudeCliSetup] install() called', {
      version,
      isPending: installMutation.isPending,
    })

    // Reset progress before starting new installation to prevent stale state
    resetProgress()

    logger.info('[useClaudeCliSetup] Calling installMutation.mutate()', {
      version,
    })
    installMutation.mutate(version, {
      onSuccess: () => {
        logger.info('[useClaudeCliSetup] mutate onSuccess callback')
        options?.onSuccess?.()
      },
      onError: error => {
        logger.error('[useClaudeCliSetup] mutate onError callback', { error })
        options?.onError?.(error)
      },
    })
  }

  return {
    status: status.data,
    isStatusLoading: status.isLoading,
    versions: versions.data ?? [],
    isVersionsLoading: versions.isFetching,
    isVersionsError: versions.isError,
    refetchVersions: versions.refetch,
    needsSetup,
    isInstalling: installMutation.isPending,
    installError: installMutation.error,
    progress,
    install,
    checkManualVersion,
    refetchStatus: status.refetch,
  }
}
