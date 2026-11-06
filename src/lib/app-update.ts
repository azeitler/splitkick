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
import { logNativeError } from '@/lib/native-log'
import { notify } from '@/lib/notifications'
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
 * The manual "Check for Updates…" action. Shared by the macOS menu bar
 * (`menu-check-updates`) and the sidebar's more menu, which is the only entry
 * on Windows and Linux (#100). Native desktop app only.
 */
export async function checkForUpdatesManually(): Promise<void> {
  if (!isNativeApp()) return
  if (!(await updateChecksEnabledForThisApp())) {
    notify('Updates are off in development builds', undefined, { type: 'info' })
    return
  }
  const ui = useUIStore.getState()
  // Package already downloaded this session — prompt restart, don't re-offer download
  if (ui.updateReadyVersion) {
    notify(
      `Update ${ui.updateReadyVersion} is ready — restart to apply`,
      undefined,
      { type: 'success' }
    )
    return
  }
  if (ui.isUpdateInstalling) {
    notify('Update download already in progress', undefined, { type: 'info' })
    return
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (update) {
      // Pass update object to App.tsx for installation handling
      window.dispatchEvent(
        new CustomEvent('update-available', { detail: update })
      )
      // Show the update modal (same as auto-check on startup)
      useUIStore.getState().setUpdateModalVersion(update.version)
    } else {
      notify('You are running the latest version', undefined, {
        type: 'success',
      })
    }
  } catch (error) {
    logNativeError(`Update check failed: ${String(error)}`)
    notify(`Failed to check for updates: ${String(error)}`, undefined, {
      type: 'error',
    })
  }
}
