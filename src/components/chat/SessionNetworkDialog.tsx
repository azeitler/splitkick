import { Network } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

export function isNodeArchived(node: SessionNetworkNode): boolean {
  return !!node.session.archived_at || node.worktreeArchived
}

function NetworkRow({
  node,
  depth,
  isCurrent,
  storeState,
  onOpen,
}: {
  node: SessionNetworkNode
  depth: number
  isCurrent: boolean
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
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm',
          archived
            ? 'cursor-default opacity-50'
            : 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
          isCurrent && 'bg-muted'
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
 * The tree of sessions around one session (#77): its root through
 * `started_by`, and every session started from there, in any project.
 * This is the schedule side (who started whom); the graph panel is the roadmap.
 */
export function SessionNetworkDialog() {
  const sessionId = useUIStore(state => state.sessionNetworkSessionId)
  const close = () => useUIStore.getState().setSessionNetworkSessionId(null)
  const { data: network, isLoading, isError } = useSessionNetwork(sessionId)
  const storeState = useCanvasStoreState()
  const depths = network ? networkDepths(network) : null

  const open = (node: SessionNetworkNode) => {
    close()
    navigateToSession({
      projectId: node.projectId,
      worktreeId: node.worktreeId,
      sessionId: node.session.id,
    })
  }

  return (
    <Dialog open={!!sessionId} onOpenChange={next => !next && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            Session network
          </DialogTitle>
          <DialogDescription>
            Which session started which. Click a session to open it.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError || !network || !depths ? (
          <p className="text-sm text-muted-foreground">
            This session is not on this device.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {network.rootParentMissing && (
              <p className="mb-1 px-2 text-xs text-muted-foreground">
                Started by a session that is not on this device.
              </p>
            )}
            <ul className="space-y-0.5" aria-label="Session network">
              {network.nodes.map(node => (
                <NetworkRow
                  key={node.session.id}
                  node={node}
                  depth={depths.get(node.session.id) ?? 0}
                  isCurrent={node.session.id === sessionId}
                  storeState={storeState}
                  onOpen={open}
                />
              ))}
            </ul>
            {network.nodes.length === 1 && (
              <p className="mt-2 px-2 text-xs text-muted-foreground">
                This session has not started other sessions.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
