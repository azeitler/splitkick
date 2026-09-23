/**
 * Host update check for remote / Web Access clients (user-triggered install).
 *
 * This is always about the **host** you are connected to, never about this
 * app. Two channels from `check_server_update`:
 * - **desktop**: host is native Jean (incl. macOS/Windows). It installs with
 *   its own Tauri updater after `apply_server_update` →
 *   `host:install-desktop-update`, reports progress back as
 *   `host:update-state`, and waits for this client to confirm the relaunch —
 *   nobody is sitting at the host machine.
 * - **server**: headless jean-server. Apply replaces the binary and restarts.
 *
 * Both render as the sticky title-bar host badge, so a host update can never be
 * mistaken for this app's own "Update available" (which stays in
 * `pendingUpdateVersion` / the update modal).
 */

import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { invoke, listen } from '@/lib/transport'
import { isLocalBackend } from '@/lib/environment'
import { logger } from '@/lib/logger'
import { useUIStore, type HostInstallPhase } from '@/store/ui-store'
import { hostUpdateLabel } from '@/lib/host-update-badge'

export type { HostInstallPhase }
export type HostUpdateChannel = 'server' | 'desktop'

/** Re-check cadence, matching the native updater check in App.tsx. */
const RECHECK_INTERVAL_MS = 30 * 60 * 1000
/** Give the host a moment to pick up an apply request before re-checking. */
const RECHECK_AFTER_APPLY_MS = 20_000

export interface HostInstallState {
  phase: HostInstallPhase
  version?: string | null
  message?: string | null
}

export interface ServerUpdateStatus {
  updateAvailable: boolean
  currentVersion: string
  latestVersion?: string | null
  notes?: string | null
  canUpdate: boolean
  reason?: string | null
  channel?: HostUpdateChannel | null
  hostInstall?: HostInstallState | null
}

interface ServerUpdateApplyResult {
  success: boolean
  version: string
  message: string
  restartScheduled: boolean
}

function normalizeChannel(raw: unknown): HostUpdateChannel {
  const value = String(raw ?? 'server').toLowerCase()
  return value === 'desktop' ? 'desktop' : 'server'
}

const PHASES: HostInstallPhase[] = [
  'idle',
  'requested',
  'downloading',
  'ready',
  'failed',
]

export function normalizeHostInstall(raw: unknown): HostInstallState {
  const value = (raw ?? {}) as Record<string, unknown>
  const phase = String(value.phase ?? 'idle').toLowerCase()
  return {
    phase: (PHASES as string[]).includes(phase)
      ? (phase as HostInstallPhase)
      : 'idle',
    version: (value.version ?? null) as string | null,
    message: (value.message ?? null) as string | null,
  }
}

export function normalizeStatus(
  raw: Record<string, unknown>
): ServerUpdateStatus {
  return {
    updateAvailable: Boolean(raw.updateAvailable ?? raw.update_available),
    currentVersion: String(raw.currentVersion ?? raw.current_version ?? ''),
    latestVersion: (raw.latestVersion ?? raw.latest_version ?? null) as
      | string
      | null,
    notes: (raw.notes ?? null) as string | null,
    canUpdate: Boolean(raw.canUpdate ?? raw.can_update),
    reason: (raw.reason ?? null) as string | null,
    channel: normalizeChannel(raw.channel),
    hostInstall: normalizeHostInstall(raw.hostInstall ?? raw.host_install),
  }
}

/** Run a fresh check and fold the answer into the sticky badge. */
export async function refreshServerUpdate(): Promise<void> {
  try {
    const raw = await invoke<Record<string, unknown>>('check_server_update')
    applyStatusToStore(normalizeStatus(raw ?? {}))
  } catch (error) {
    // Silent: offline / unsupported hosts / older servers without the command
    logger.debug('Server update re-check skipped', { error: String(error) })
  }
}

/** Store the offer, or clear it once the host is current. */
function applyStatusToStore(status: ServerUpdateStatus): void {
  if (!status.updateAvailable || !status.latestVersion) {
    useUIStore.getState().setPendingServerUpdate(null)
    return
  }
  const install = status.hostInstall ?? { phase: 'idle' as HostInstallPhase }
  useUIStore.getState().setPendingServerUpdate({
    latestVersion: status.latestVersion,
    currentVersion: status.currentVersion,
    canUpdate: status.canUpdate,
    reason: status.reason,
    channel: status.channel ?? 'server',
    hostInstallPhase: install.phase,
    hostInstallMessage: install.message ?? null,
  })
}

/**
 * Apply a pending host update (title-bar badge or toast action).
 *
 * On a desktop host this only *requests* the install; the host answers with
 * `host:update-state` and the badge becomes "Restart host" when it is done.
 * Reporting success here would clear the badge before anything was installed,
 * and the next check would offer the same version again.
 */
export async function applyServerUpdate(version: string): Promise<void> {
  const pending = useUIStore.getState().pendingServerUpdate
  const channel = pending?.channel ?? 'server'
  const isRestart = pending?.hostInstallPhase === 'ready'
  const toastId = toast.loading(
    isRestart
      ? `Restarting the host to apply ${version}...`
      : `Installing update ${version}...`
  )
  try {
    const result = await invoke<ServerUpdateApplyResult>('apply_server_update')

    if (result.restartScheduled) {
      // Binary replaced (server) or host relaunching (desktop) — offer is done.
      useUIStore.getState().setPendingServerUpdate(null)
      toast.dismiss('server-update-available')
      toast.success(result.message || `Installed update ${result.version}`, {
        id: toastId,
        description:
          'The host is restarting. This page will reconnect automatically.',
        duration: 12_000,
      })
      return
    }

    // Desktop host: nothing is installed yet — the request only reached the
    // host shell. Keep the badge; the phase arrives on `host:update-state`,
    // which the backend broadcasts, so do not guess it here.
    toast.info(result.message || `Update ${result.version} requested`, {
      id: toastId,
      description: `You will be asked here when ${hostUpdateLabel(channel)} is ready to restart.`,
      duration: 12_000,
    })
    setTimeout(() => void refreshServerUpdate(), RECHECK_AFTER_APPLY_MS)
  } catch (error) {
    logger.error('Failed to apply host update', { error })
    // Keep the badge so the title-bar control stays for retry.
    toast.error(`Update failed: ${String(error)}`, {
      id: toastId,
      duration: 10_000,
    })
  }
}

export function useServerUpdateCheck() {
  const toastShownForVersionRef = useRef<string | null>(null)

  const presentUpdate = useCallback((status: ServerUpdateStatus) => {
    applyStatusToStore(status)

    if (!status.updateAvailable || !status.latestVersion) return

    const version = status.latestVersion
    const channel = status.channel ?? 'server'
    const target = hostUpdateLabel(channel)

    // One-shot toast per version (optional nudge). Closing it does not clear
    // pendingServerUpdate — the header badge remains.
    if (toastShownForVersionRef.current === version) return
    toastShownForVersionRef.current = version

    const title =
      channel === 'desktop'
        ? `Jean ${version} is available on the host`
        : `jean-server ${version} is available`

    if (!status.canUpdate) {
      toast.info(title, {
        id: 'server-update-available',
        description:
          status.reason ||
          'This host cannot self-update. Replace the binary or image manually.',
        duration: 12_000,
      })
      return
    }

    toast.info(title, {
      id: 'server-update-available',
      description: `${target} is on ${status.currentVersion}. A permanent control stays in the title bar if you dismiss this.`,
      duration: 12_000,
      action: {
        label: channel === 'desktop' ? 'Update host' : 'Update & restart',
        onClick: () => {
          void applyServerUpdate(version)
        },
      },
    })
  }, [])

  useEffect(() => {
    if (isLocalBackend()) {
      useUIStore.getState().setPendingServerUpdate(null)
      return
    }

    let cancelled = false

    const check = async () => {
      if (cancelled) return
      try {
        const raw = await invoke<Record<string, unknown>>('check_server_update')
        if (cancelled) return
        presentUpdate(normalizeStatus(raw ?? {}))
      } catch (error) {
        // Silent: offline / unsupported hosts / older servers without the command
        logger.debug('Server update check skipped', { error: String(error) })
      }
    }

    // Wait for WebSocket/backend to be ready, then keep checking so the badge
    // disappears on its own once the host is current.
    const first = setTimeout(() => void check(), 8_000)
    const interval = setInterval(() => void check(), RECHECK_INTERVAL_MS)

    // Live progress of an install running on the host.
    let unlisten: (() => void) | undefined
    void listen<Record<string, unknown>>('host:update-state', event => {
      if (cancelled) return
      const install = normalizeHostInstall(event.payload)
      const current = useUIStore.getState().pendingServerUpdate
      if (!current) return
      useUIStore.getState().setPendingServerUpdate({
        ...current,
        hostInstallPhase: install.phase,
        hostInstallMessage: install.message ?? null,
      })
      if (install.phase === 'idle') void check()
    }).then(fn => {
      if (cancelled) fn()
      else unlisten = fn
    })

    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(interval)
      unlisten?.()
    }
  }, [presentUpdate])
}
