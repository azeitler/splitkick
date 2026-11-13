import { StatusIndicator } from '@/components/ui/status-indicator'
import { BackendLabel } from '@/components/ui/backend-label'
import { navigateToSession } from '@/lib/navigate-to-session'
import { cn } from '@/lib/utils'
import { useSessionNetwork } from '@/services/chat'
import { useUIStore } from '@/store/ui-store'
import type { SessionNetwork, SessionNetworkNode } from '@/types/chat'
import { useCanvasStoreState } from './hooks/useCanvasStoreState'
import {
  computeSessionCardData,
  statusConfig,
  type ChatStoreState,
} from './session-card-utils'

/** Depth of each node below the root. Nodes arrive depth-first, root first. */
export function networkDepths(network: SessionNetwork): Map<string, number> {
  const depths = new Map<string, number>()
  for (const node of network.nodes) {
    const parentDepth = node.parentId ? depths.get(node.parentId) : undefined
    depths.set(node.session.id, parentDepth === undefined ? 0 : parentDepth + 1)
  }
  return depths
}

export interface NetworkRowEntry {
  node: SessionNetworkNode
  depth: number
}

/**
 * The rows around one session: its parent as a single row (if it has one),
 * then the session itself and every session started from it, as a tree.
 * Siblings and the rest of the parent's tree are left out.
 */
export function focusedNetworkRows(
  network: SessionNetwork,
  focusId: string
): NetworkRowEntry[] {
  const depths = networkDepths(network)
  const focus = network.nodes.find(node => node.session.id === focusId)
  if (!focus) {
    return network.nodes.map(node => ({
      node,
      depth: depths.get(node.session.id) ?? 0,
    }))
  }
  const parent = focus.parentId
    ? network.nodes.find(node => node.session.id === focus.parentId)
    : undefined
  // Nodes arrive depth-first, so a parent is always seen before its children.
  const inSubtree = new Set([focusId])
  for (const node of network.nodes) {
    if (node.parentId && inSubtree.has(node.parentId)) {
      inSubtree.add(node.session.id)
    }
  }
  const offset = (parent ? 1 : 0) - (depths.get(focusId) ?? 0)
  const rows: NetworkRowEntry[] = parent ? [{ node: parent, depth: 0 }] : []
  for (const node of network.nodes) {
    if (!inSubtree.has(node.session.id)) continue
    rows.push({ node, depth: (depths.get(node.session.id) ?? 0) + offset })
  }
  return rows
}

export function isNodeArchived(node: SessionNetworkNode): boolean {
  return !!node.session.archived_at || node.worktreeArchived
}

function NetworkRow({
  node,
  depth,
  isCurrent,
  isFocus,
  storeState,
  onOpen,
}: {
  node: SessionNetworkNode
  depth: number
  isCurrent: boolean
  isFocus: boolean
  storeState: ChatStoreState
  onOpen: (node: SessionNetworkNode) => void
}) {
  const archived = isNodeArchived(node)
  const config =
    statusConfig[computeSessionCardData(node.session, storeState).status]
  const statusLabel = archived ? 'Archived' : config.label
  return (
    <li>
      <button
        type="button"
        disabled={archived}
        onClick={() => onOpen(node)}
        title={
          archived
            ? 'Archived. Restore it from the archive to open it.'
            : undefined
        }
        style={{ paddingLeft: `${0.5 + depth}rem` }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm',
          archived
            ? 'cursor-default opacity-50'
            : 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
          (isCurrent || isFocus) && 'bg-muted'
        )}
      >
        {depth > 0 && (
          <span aria-hidden className="shrink-0 text-muted-foreground">
            └
          </span>
        )}
        <StatusIndicator
          status={archived ? 'idle' : config.indicatorStatus}
          variant={config.indicatorVariant}
          shape={config.indicatorShape}
          label={statusLabel}
          className="h-2 w-2 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{node.session.name}</span>
            {isCurrent && (
              <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                This session
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {node.projectName} › {node.worktreeName}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end text-xs text-muted-foreground">
          {node.session.backend && (
            <BackendLabel backend={node.session.backend} />
          )}
          <span>{statusLabel}</span>
        </span>
      </button>
    </li>
  )
}

/**
 * The sessions around one session (#77): the session that started it (one
 * row), and every session it started, in any project. Siblings started by the
 * same parent are not shown; open the parent to see them.
 * This is the schedule side (who started whom); the Graph tab is the roadmap.
 * Shown in the left panel's Network tab (#98); live through the `sessions`
 * cache invalidation.
 */
export function SessionNetworkTree({
  sessionId,
  currentSessionId,
  onOpened,
}: {
  /** The session whose network to show. */
  sessionId: string
  /** The session open on screen; marked "This session". */
  currentSessionId: string | null
  /** Called after a click opened a session. */
  onOpened?: () => void
}) {
  const { data: network, isLoading, isError } = useSessionNetwork(sessionId)
  const storeState = useCanvasStoreState()
  const rows = network ? focusedNetworkRows(network, sessionId) : null

  const open = (node: SessionNetworkNode) => {
    // The opened session is in this network, so the pin is no longer needed.
    useUIStore.getState().setSessionNetworkSessionId(null)
    navigateToSession({
      projectId: node.projectId,
      worktreeId: node.worktreeId,
      sessionId: node.session.id,
    })
    onOpened?.()
  }

  if (isLoading) {
    return <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
  }
  if (isError || !network || !rows) {
    return (
      <p className="px-2 py-4 text-sm text-muted-foreground">
        This session is not on this device.
      </p>
    )
  }
  return (
    <div className="p-1">
      {network.rootParentMissing && sessionId === network.rootId && (
        <p className="mb-1 px-2 text-xs text-muted-foreground">
          Started by a session that is not on this device.
        </p>
      )}
      <ul className="space-y-0.5" aria-label="Session network">
        {rows.map(({ node, depth }) => (
          <NetworkRow
            key={node.session.id}
            node={node}
            depth={depth}
            isCurrent={node.session.id === currentSessionId}
            isFocus={node.session.id === sessionId}
            storeState={storeState}
            onOpen={open}
          />
        ))}
      </ul>
      {!rows.some(({ node }) => node.parentId === sessionId) && (
        <p className="mt-2 px-2 text-xs text-muted-foreground">
          This session has not started other sessions.
        </p>
      )}
    </div>
  )
}
