import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke, listen } from '@/lib/transport'

/** Mirrors `BackupProgress` in jean-core/src/session_backup/mod.rs */
export interface SessionBackupProgress {
  phase: 'scanning' | 'copying' | 'digest' | 'done' | 'cancelled' | 'failed'
  files_done: number
  files_total: number
  bytes_done: number
  bytes_total: number
  /** Session id being copied, or the error text when `phase` is `failed` */
  current: string | null
}

export interface SessionBackupInstance {
  instance_id: string
  device_name: string
  app_version: string
  last_sync_at: number
}

export interface SessionBackupStatus {
  enabled: boolean
  backup_dir: string | null
  instance_id: string
  device_name: string
  running: boolean
  last_sync_at: number | null
  last_error: string | null
  files_copied: number
  bytes_copied: number
  duration_ms: number
  other_instances: SessionBackupInstance[]
}

export interface SessionBackupEstimate {
  bytes_needed: number
  files: number
  free_bytes: number | null
}

const statusKey = ['session-backup-status']

export function useSessionBackupStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: () => invoke<SessionBackupStatus>('get_session_backup_status'),
  })
}

export const runSessionBackupNow = () => invoke('run_session_backup_now')
export const cancelSessionBackup = () => invoke('cancel_session_backup')
export const estimateSessionBackup = (dir: string) =>
  invoke<SessionBackupEstimate>('estimate_session_backup', { dir })
export const getDefaultDeviceName = () =>
  invoke<string>('get_default_device_name')

const FINISHED = new Set(['done', 'cancelled', 'failed'])

/**
 * The latest `session-backup:progress` event, background runs included.
 * Refreshes the status query when a run finishes.
 */
export function useSessionBackupProgress() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<SessionBackupProgress | null>(null)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    listen<SessionBackupProgress>('session-backup:progress', event => {
      setProgress(event.payload)
      if (FINISHED.has(event.payload.phase)) {
        queryClient.invalidateQueries({ queryKey: statusKey })
      }
    }).then(fn => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [queryClient])

  return progress
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** 0–100 for a progress bar; bytes, since one 200 MB log outweighs 100 files. */
export function progressPercent(progress: SessionBackupProgress): number {
  if (progress.phase === 'done') return 100
  // The digest phase counts sessions; bytes are all copied by then.
  if (progress.phase === 'digest') {
    if (progress.files_total === 0) return 100
    return Math.round((progress.files_done / progress.files_total) * 100)
  }
  if (progress.bytes_total === 0) return 0
  return Math.min(
    100,
    Math.round((progress.bytes_done / progress.bytes_total) * 100)
  )
}
