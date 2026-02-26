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
import {
  useCodexCliStatus,
  useAvailableCodexVersions,
} from '@/services/codex-cli'
import {
  useOpencodeCliStatus,
  useAvailableOpencodeVersions,
} from '@/services/opencode-cli'
import { useUIStore } from '@/store/ui-store'
import { isNewerVersion } from '@/lib/version-utils'
import { logger } from '@/lib/logger'

interface CliUpdateInfo {
  type: 'claude' | 'gh' | 'codex' | 'opencode'
  currentVersion: string
  latestVersion: string
}

const CLI_DISPLAY_NAMES: Record<CliUpdateInfo['type'], string> = {
  claude: 'Claude CLI',
  gh: 'GitHub CLI',
  codex: 'Codex CLI',
  opencode: 'OpenCode CLI',
}

/**
 * Hook that checks for CLI updates on startup and periodically (every hour).
 * Shows toast notifications when updates are detected.
 * Should be called once in App.tsx.
 */
export function useCliVersionCheck() {
  const { data: claudeStatus, isLoading: claudeLoading } = useClaudeCliStatus()
  const { data: ghStatus, isLoading: ghLoading } = useGhCliStatus()
  const { data: codexStatus, isLoading: codexLoading } = useCodexCliStatus()
  const { data: opencodeStatus, isLoading: opencodeLoading } =
    useOpencodeCliStatus()
  const { data: claudeVersions, isLoading: claudeVersionsLoading } =
    useAvailableCliVersions()
  const { data: ghVersions, isLoading: ghVersionsLoading } =
    useAvailableGhVersions()
  const { data: codexVersions, isLoading: codexVersionsLoading } =
    useAvailableCodexVersions()
  const { data: opencodeVersions, isLoading: opencodeVersionsLoading } =
    useAvailableOpencodeVersions()

  // Track which update pairs we've already shown notifications for
  // Format: "type:currentVersion→latestVersion"
  const notifiedRef = useRef<Set<string>>(new Set())
  const isInitialCheckRef = useRef(true)

  useEffect(() => {
    // Wait until all data is loaded
    const isLoading =
      claudeLoading ||
      ghLoading ||
      codexLoading ||
      opencodeLoading ||
      claudeVersionsLoading ||
      ghVersionsLoading ||
      codexVersionsLoading ||
      opencodeVersionsLoading
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

    // Check Codex CLI
    if (
      codexStatus?.installed &&
      codexStatus.version &&
      codexVersions?.length
    ) {
      const latestStable = codexVersions.find(v => !v.prerelease)
      if (
        latestStable &&
        isNewerVersion(latestStable.version, codexStatus.version)
      ) {
        const key = `codex:${codexStatus.version}→${latestStable.version}`
        if (!notifiedRef.current.has(key)) {
          notifiedRef.current.add(key)
          updates.push({
            type: 'codex',
            currentVersion: codexStatus.version,
            latestVersion: latestStable.version,
          })
        }
      }
    }

    // Check OpenCode CLI
    if (
      opencodeStatus?.installed &&
      opencodeStatus.version &&
      opencodeVersions?.length
    ) {
      const latestStable = opencodeVersions.find(v => !v.prerelease)
      if (
        latestStable &&
        isNewerVersion(latestStable.version, opencodeStatus.version)
      ) {
        const key = `opencode:${opencodeStatus.version}→${latestStable.version}`
        if (!notifiedRef.current.has(key)) {
          notifiedRef.current.add(key)
          updates.push({
            type: 'opencode',
            currentVersion: opencodeStatus.version,
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
    codexStatus,
    opencodeStatus,
    claudeVersions,
    ghVersions,
    codexVersions,
    opencodeVersions,
    claudeLoading,
    ghLoading,
    codexLoading,
    opencodeLoading,
    claudeVersionsLoading,
    ghVersionsLoading,
    codexVersionsLoading,
    opencodeVersionsLoading,
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
    const cliName = CLI_DISPLAY_NAMES[update.type]
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
