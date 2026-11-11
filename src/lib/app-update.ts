/**
 * App auto-update lifecycle helpers.
 *
 * States:
 * - available / deferred: user postponed install (`pendingUpdateVersion` badge)
 * - installing: download in progress
 * - ready: package downloaded; it is installed right before the relaunch
 *   (a bundle replaced under the running process loses macOS folder access)
 *
 * After a successful download the running binary is still the old version, so
 * `check()` continues to report an update. Without the ready/installing guards
 * the UI re-offers "Update available" and can re-download in a loop (#507).
 */

import { isNativeApp } from '@/lib/environment'
import { toast } from 'sonner'
import { logNativeError, logNativeInfo } from '@/lib/native-log'
import { notify } from '@/lib/notifications'
import { invoke } from '@/lib/transport'
import { useUIStore } from '@/store/ui-store'

/** Bundle identifier of the released app (`src-tauri/tauri.fork.conf.json`). */
export const RELEASE_IDENTIFIER = 'app.splitkick.desktop'

/**
 * Only the released app checks for updates. Dev builds, test builds with their
 * own identifier (`app.splitkick.desktop.rel76`) and builds from upstream's
 * base config would otherwise offer, download and install a release over
 * themselves. `import.meta.env.DEV` is not enough: a debug build with a built
 * frontend has it set to false.
 */
export function isUpdateCheckEnabled(identifier: string): boolean {
  return identifier === RELEASE_IDENTIFIER
}

let updateCheckEnabled: Promise<boolean> | null = null

/** `isUpdateCheckEnabled` for this app; false when the identifier is unknown. */
export function updateChecksEnabledForThisApp(): Promise<boolean> {
  updateCheckEnabled ??= import('@tauri-apps/api/app')
    .then(({ getIdentifier }) => getIdentifier())
    .then(isUpdateCheckEnabled)
    .catch(() => false)
  return updateCheckEnabled
}

export interface AppUpdateGuardState {
  pendingUpdateVersion: string | null
  updateReadyVersion: string | null
  isUpdateInstalling: boolean
}

/** Whether auto / menu update checks should surface a new offer. */
export function shouldOfferUpdateCheck(state: AppUpdateGuardState): boolean {
  if (state.isUpdateInstalling) return false
  if (state.updateReadyVersion) return false
  if (state.pendingUpdateVersion) return false
  return true
}

export type InstallPendingAction = 'relaunch' | 'install' | 'noop'

/**
 * Resolve what clicking the title-bar badge / "Update Now" should do.
 * Prefer relaunch once the package is already installed.
 */
export function resolveInstallPendingAction(state: {
  updateReadyVersion: string | null
  isUpdateInstalling: boolean
  hasPendingUpdateObject: boolean
}): InstallPendingAction {
  if (state.isUpdateInstalling) return 'noop'
  if (state.updateReadyVersion) return 'relaunch'
  if (state.hasPendingUpdateObject) return 'install'
  return 'noop'
}

/**
 * Install a downloaded update, then relaunch. Called only at relaunch time,
 * so the bundle is never replaced under a process that keeps running. When
 * the install fails, the app does not relaunch.
 */
export async function installAndRelaunch(
  downloaded: { install: () => Promise<void> } | null,
  relaunch: () => Promise<void>
): Promise<void> {
  if (downloaded) await downloaded.install()
  await relaunch()
}

/**
 * The error text of a failed updater check, plus its cause, and log both.
 *
 * tauri-plugin-updater reports a non-2xx feed answer only as "Could not fetch
 * a valid release JSON from the remote" (#113). The Rust side fetches the
 * feed once more and names the host, HTTP status, parse error, missing
 * platform key, or network/TLS/proxy error.
 */
export async function describeUpdateCheckFailure(
  error: unknown
): Promise<string> {
  let message = String(error)
  try {
    const cause = await invoke<string>('diagnose_update_check')
    if (cause) message = `${message} (${cause})`
  } catch (diagnosisError) {
    message = `${message} (diagnosis failed: ${String(diagnosisError)})`
  }
  logNativeError(`Update check failed: ${message}`)
  return message
}

/**
 * The manual "Check for Updates…" action. Shared by the macOS menu bar
 * (`menu-check-updates`) and the sidebar's more menu, which is the only entry
 * on Windows and Linux (#100). Native desktop app only.
 */
/** A manual check that gets no answer ends with an error, not in silence. */
export const MANUAL_CHECK_TIMEOUT_MS = 30_000

export async function checkForUpdatesManually(): Promise<void> {
  if (!isNativeApp()) return
  if (!(await updateChecksEnabledForThisApp())) {
    logNativeInfo('Update check (manual): off for this build')
    notify('Updates are off in development builds', undefined, { type: 'info' })
    return
  }
  const ui = useUIStore.getState()
  // Package already downloaded this session: show the restart prompt, no new download
  if (ui.updateReadyVersion) {
    logNativeInfo(
      `Update check (manual): ${ui.updateReadyVersion} already downloaded`
    )
    // Open the restart prompt again: a dismissed prompt must come back
    // when the user asks (a toast alone had no Restart button).
    ui.setUpdateModalVersion(ui.updateReadyVersion)
    return
  }
  if (ui.isUpdateInstalling) {
    logNativeInfo('Update check (manual): download already running')
    notify('Update download already in progress', undefined, { type: 'info' })
    return
  }
  // Visible at once, and every result is logged: a click that shows nothing
  // could not be told apart from a check that found nothing (Nigel, 1.5.9).
  logNativeInfo('Update check (manual): started')
  const checking = toast.loading('Checking for updates…')
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({ timeout: MANUAL_CHECK_TIMEOUT_MS })
    toast.dismiss(checking)
    if (update) {
      logNativeInfo(`Update check (manual): ${update.version} available`)
      // Pass update object to App.tsx for installation handling
      window.dispatchEvent(
        new CustomEvent('update-available', { detail: update })
      )
      // Show the update modal (same as auto-check on startup)
      useUIStore.getState().setUpdateModalVersion(update.version)
    } else {
      logNativeInfo('Update check (manual): no newer version')
      notify('You are running the latest version', undefined, {
        type: 'success',
      })
    }
  } catch (error) {
    toast.dismiss(checking)
    const message = await describeUpdateCheckFailure(error)
    notify(`Failed to check for updates: ${message}`, undefined, {
      type: 'error',
    })
  }
}
