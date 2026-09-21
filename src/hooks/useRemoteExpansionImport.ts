import { useEffect } from 'react'
import { useProjectsStore } from '@/store/projects-store'
import { aggregatesServers } from '@/lib/environment'
import { useRemoteConnections } from '@/lib/remote-connections'
import {
  invokeOnServer,
  useServerConnectionSnapshots,
} from '@/lib/server-connections'
import { serverResourceKey } from '@/lib/server-resource'
import type { UIState } from '@/types/ui-state'

export const REMOTE_EXPANSION_IMPORTED_KEY = 'jean-remote-expansion-imported'

type ExpansionState = Pick<
  UIState,
  'expanded_project_ids' | 'expanded_folder_ids' | 'expanded_worktree_ids'
>

function importedServerIds(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(REMOTE_EXPANSION_IMPORTED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : []
    )
  } catch {
    return new Set()
  }
}

function markImported(serverId: string): void {
  const ids = importedServerIds()
  ids.add(serverId)
  try {
    globalThis.localStorage?.setItem(
      REMOTE_EXPANSION_IMPORTED_KEY,
      JSON.stringify([...ids])
    )
  } catch {
    // Without storage the import simply runs again next start; it only adds.
  }
}

/**
 * Add a remote's saved expansion to the sidebar, keyed the way the main window
 * keys that remote's resources. Only adds: a row the user already opened or
 * closed here keeps its state.
 */
export function mergeServerExpansion(
  serverId: string,
  state: ExpansionState
): void {
  const scope = (ids: string[] | undefined) =>
    (ids ?? []).map(resourceId => serverResourceKey({ serverId, resourceId }))
  const union = (current: Set<string>, ids: string[]) =>
    ids.every(id => current.has(id)) ? current : new Set([...current, ...ids])

  useProjectsStore.setState(store => ({
    expandedProjectIds: union(
      store.expandedProjectIds,
      scope(state.expanded_project_ids)
    ),
    expandedFolderIds: union(
      store.expandedFolderIds,
      scope(state.expanded_folder_ids)
    ),
    expandedWorktreeIds: union(
      store.expandedWorktreeIds,
      scope(state.expanded_worktree_ids)
    ),
  }))
}

/**
 * Before 1.0 every remote had a window of its own, and that window saved its
 * expanded rows in the remote's UI state. The main window now shows remote
 * projects itself and keeps expansion per client, so it starts with every
 * remote row collapsed. Import each remote's saved expansion once, the first
 * time the remote is online after the upgrade.
 */
export function useRemoteExpansionImport(isInitialized: boolean): void {
  const connections = useRemoteConnections()
  const snapshots = useServerConnectionSnapshots()
  const onlineIds = connections
    .filter(connection => connection.enabled !== false)
    .map(connection => connection.id)
    .filter(id => snapshots.get(id)?.status === 'online')
    .join('|')

  useEffect(() => {
    if (!isInitialized || !onlineIds || !aggregatesServers()) return

    const done = importedServerIds()
    let cancelled = false
    for (const serverId of onlineIds.split('|')) {
      if (done.has(serverId)) continue
      void invokeOnServer<UIState>(serverId, 'load_ui_state')
        .then(state => {
          if (cancelled) return
          mergeServerExpansion(serverId, state ?? {})
          markImported(serverId)
        })
        .catch(() => {
          // Try again the next time the remote comes online.
        })
    }
    return () => {
      cancelled = true
    }
  }, [isInitialized, onlineIds])
}
