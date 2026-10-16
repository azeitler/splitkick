import { invoke } from '@/lib/transport'
import { isNativeApp } from '@/lib/environment'
import {
  getActiveConnectionId,
  LOCAL_CONNECTION_ID,
} from '@/lib/remote-connections'
import { relaunchAfterUIStateSave } from '@/lib/ui-state-teardown'

export type FullDiskAccessStatus = 'granted' | 'denied' | 'not_applicable'

let statusPromise: Promise<FullDiskAccessStatus> | null = null

/**
 * macOS Full Disk Access status of the local Splitkick app (issue #31).
 *
 * Probed once per app run and cached: a running process keeps the TCC state
 * it started with, so after the user grants access the probe stays `denied`
 * until the app relaunches. Re-checking never helps — offer a relaunch.
 *
 * Web Access and remote windows report `not_applicable`: the grant belongs to
 * the Mac that runs this window, not to a server elsewhere.
 */
export function getFullDiskAccessStatus(): Promise<FullDiskAccessStatus> {
  if (!isNativeApp() || getActiveConnectionId() !== LOCAL_CONNECTION_ID) {
    return Promise.resolve('not_applicable')
  }
  statusPromise ??= invoke<FullDiskAccessStatus>(
    'get_full_disk_access_status'
  ).catch(() => 'not_applicable' as const)
  return statusPromise
}

/** Open System Settings → Privacy & Security → Full Disk Access. */
export function openFullDiskAccessSettings(): Promise<void> {
  return invoke('open_full_disk_access_settings')
}

/** Relaunch so the new TCC grant takes effect. */
export async function relaunchForFullDiskAccess(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunchAfterUIStateSave(relaunch)
}

/** Test-only: forget the cached probe result. */
export function resetFullDiskAccessStatusForTests(): void {
  statusPromise = null
}
