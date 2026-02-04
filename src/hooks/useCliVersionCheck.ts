/**
 * CLI Version Check Hook
 *
 * Checks for CLI updates on application startup and shows toast notifications
 * with buttons to update directly.
 */

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  useClaudeCliStatus,
  useAvailableCliVersions,
} from '@/services/claude-cli'
import { useGhCliStatus, useAvailableGhVersions } from '@/services/gh-cli'
import { useUIStore } from '@/store/ui-store'
import { isNewerVersion } from '@/lib/version-utils'
import { logger } from '@/lib/logger'

interface CliUpdateInfo {
  type: 'claude' | 'gh'
  currentVersion: string
  latestVersion: string
}

/**
 * Hook that checks for CLI updates on startup and periodically (every hour).
 * Shows toast notifications when updates are detected.
 * Should be called once in App.tsx.
 */
export function useCliVersionCheck() {
  const { data: claudeStatus, isLoading: claudeLoading } = useClaudeCliStatus()
  const { data: ghStatus, isLoading: ghLoading } = useGhCliStatus()
  const { data: claudeVersions, isLoading: claudeVersionsLoading } =
    useAvailableCliVersions()
  const { data: ghVersions, isLoading: ghVersionsLoading } =
    useAvailableGhVersions()

  // Track which update pairs we've already shown notifications for
  // Format: "type:currentVersion→latestVersion"
  const notifiedRef = useRef<Set<string>>(new Set())
  const isInitialCheckRef = useRef(true)

  useEffect(() => {
    // Wait until all data is loaded
    const isLoading =
      claudeLoading || ghLoading || claudeVersionsLoading || ghVersionsLoading
    if (isLoading) return

    const updates: CliUpdateInfo[] = []

    // Check Claude CLI
    if (
      claudeStatus?.installed &&
      claudeStatus.version &&
      claudeVersions?.length
    ) {
      const latestStable = claudeVersions.find(v => !v.prerelease)
      if (
        latestStable &&
        isNewerVersion(latestStable.version, claudeStatus.version)
      ) {
        const key = `claude:${claudeStatus.version}→${latestStable.version}`
        if (!notifiedRef.current.has(key)) {
          notifiedRef.current.add(key)
          updates.push({
            type: 'claude',
            currentVersion: claudeStatus.version,
            latestVersion: latestStable.version,
          })
        }
      }
    }

    // Check GitHub CLI
    if (ghStatus?.installed && ghStatus.version && ghVersions?.length) {
      const latestStable = ghVersions.find(v => !v.prerelease)
      if (
        latestStable &&
        isNewerVersion(latestStable.version, ghStatus.version)
      ) {
        const key = `gh:${ghStatus.version}→${latestStable.version}`
        if (!notifiedRef.current.has(key)) {
          notifiedRef.current.add(key)
          updates.push({
            type: 'gh',
            currentVersion: ghStatus.version,
            latestVersion: latestStable.version,
          })
        }
      }
    }

    if (updates.length > 0) {
      logger.info('CLI updates available', { updates })

      if (isInitialCheckRef.current) {
        // Delay initial notification to let the app settle
        setTimeout(() => {
          showUpdateToasts(updates)
        }, 5000)
      } else {
        showUpdateToasts(updates)
      }
    }

    isInitialCheckRef.current = false
  }, [
    claudeStatus,
    ghStatus,
    claudeVersions,
    ghVersions,
    claudeLoading,
    ghLoading,
    claudeVersionsLoading,
    ghVersionsLoading,
  ])
}

/**
 * Show toast notifications for each CLI update.
 * Each CLI gets its own toast with Update and Cancel buttons.
 * Toast stays visible until user dismisses it.
 */
function showUpdateToasts(updates: CliUpdateInfo[]) {
  const { openCliUpdateModal } = useUIStore.getState()

  for (const update of updates) {
    const cliName = update.type === 'claude' ? 'Claude CLI' : 'GitHub CLI'
    const toastId = `cli-update-${update.type}`

    toast.info(`${cliName} update available`, {
      id: toastId,
      description: `v${update.currentVersion} → v${update.latestVersion}`,
      duration: Infinity, // Don't auto-dismiss
      action: {
        label: 'Update',
        onClick: () => {
          openCliUpdateModal(update.type)
          toast.dismiss(toastId)
        },
      },
      cancel: {
        label: 'Cancel',
        onClick: () => {
          toast.dismiss(toastId)
        },
      },
    })
  }
}
