/**
 * Label and tooltip for the host-update badge in the title bar.
 *
 * The badge is about the **host** a remote client is connected to, never about
 * this app — conflating the two made every remote session read "Update
 * available" as if the local app were out of date. A desktop host installs
 * with its own Tauri updater and cannot ask anyone to restart it, so the badge
 * walks the install phases and ends on "Restart host".
 */

import type { PendingServerUpdate } from '@/store/ui-store'

export interface HostUpdateBadge {
  label: string
  tooltip: string
  /** Install is running on the host — the control is disabled. */
  busy: boolean
}

/** Name for the thing being updated. */
export function hostUpdateLabel(
  channel: PendingServerUpdate['channel']
): string {
  return channel === 'desktop' ? 'the host Jean app' : 'jean-server'
}

export function hostUpdateBadge(pending: PendingServerUpdate): HostUpdateBadge {
  const isDesktop = pending.channel === 'desktop'
  const target = hostUpdateLabel(pending.channel)
  const phase = pending.hostInstallPhase
  const busy = isDesktop && (phase === 'requested' || phase === 'downloading')

  const label = !isDesktop
    ? 'Server update'
    : phase === 'ready'
      ? 'Restart host'
      : busy
        ? 'Updating host…'
        : phase === 'failed'
          ? 'Host update failed'
          : 'Host update'

  const tooltip = !pending.canUpdate
    ? `${target} v${pending.latestVersion} available — ${pending.reason || 'manual update required'}`
    : phase === 'ready' && isDesktop
      ? `v${pending.latestVersion} is installed on the host. Restart it to apply.`
      : busy
        ? `Installing v${pending.latestVersion} on the host…`
        : phase === 'failed' && isDesktop
          ? `Host install failed — ${pending.hostInstallMessage || 'retry the update'}`
          : `Update ${target} to v${pending.latestVersion} (currently v${pending.currentVersion})`

  return { label, tooltip, busy }
}
