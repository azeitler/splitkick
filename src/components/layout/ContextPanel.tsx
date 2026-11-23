import type { ReactNode } from 'react'
import { FolderTree, Network, Package, Workflow, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  FileBrowserRefreshButton,
  FileBrowserSidebar,
  useFileBrowserRootPath,
} from '@/components/file-browser/FileBrowserSidebar'
import { SessionNetworkTree } from '@/components/chat/SessionNetworkTree'
import { SessionGraphPanel } from '@/components/graphs/SessionGraphPanel'
import {
  SessionArtifactsTab,
  useSessionArtifacts,
} from '@/components/artifacts/SessionArtifactsTab'
import { useIsMobile } from '@/hooks/use-mobile'
import { useActiveSessionTarget } from '@/lib/session-transfer'
import { cn } from '@/lib/utils'
import { useSessionNetwork, useSessions } from '@/services/chat'
import { useWorktree } from '@/services/projects'
import { useUIStore, type ContextPanelTab } from '@/store/ui-store'

const TABS: { id: ContextPanelTab; label: string; icon: typeof Network }[] = [
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'graph', label: 'Graph', icon: Workflow },
  { id: 'artifacts', label: 'Artifacts', icon: Package },
]

/**
 * The left context panel (#98): Files | Network | Graph | Artifacts for the session on
 * screen. Same place, width and visibility (`fileBrowserVisible`) as the
 * file tree before it. The desktop sidebar and the phone drawer both render
 * it; tabs that cannot show anything stay visible but disabled.
 *
 * A header names the active tab and what it shows, with the tab's actions
 * and the close button; below it every tab shows its name and, where one
 * exists, a count.
 */
export function ContextPanel() {
  const isMobile = useIsMobile()
  const tab = useUIStore(state => state.contextPanelTab)
  const pinnedNetworkId = useUIStore(state => state.sessionNetworkSessionId)
  const target = useActiveSessionTarget()
  const currentSessionId = target?.sessionId ?? null
  const networkSessionId = pinnedNetworkId ?? currentSessionId

  // A tab that cannot show anything stays visible, disabled with its reason.
  const reasons: Record<ContextPanelTab, string | null> = {
    files: null,
    network: networkSessionId ? null : 'Open a session to see its network.',
    graph: currentSessionId ? null : 'Open a session to see its graph.',
    artifacts: currentSessionId ? null : 'Open a session to see its artifacts.',
  }
  const reason = reasons[tab]

  let content: ReactNode
  if (reason) {
    content = (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        {reason}
      </p>
    )
  } else if (tab === 'files') {
    content = <FileBrowserSidebar hideHeader className="min-h-0 flex-1" />
  } else if (tab === 'network' && networkSessionId) {
    content = (
      <ScrollArea className="min-h-0 flex-1">
        {pinnedNetworkId && pinnedNetworkId !== currentSessionId && (
          <div className="flex items-center gap-2 border-b border-sidebar-border px-3 py-1.5 text-xs text-muted-foreground">
            <span className="flex-1">Network of another session.</span>
            {currentSessionId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() =>
                  useUIStore.getState().setSessionNetworkSessionId(null)
                }
              >
                Show this session
              </Button>
            )}
          </div>
        )}
        <SessionNetworkTree
          sessionId={networkSessionId}
          currentSessionId={currentSessionId}
          onOpened={
            isMobile
              ? () => useUIStore.getState().setFileBrowserVisible(false)
              : undefined
          }
        />
      </ScrollArea>
    )
  } else if (tab === 'artifacts' && target) {
    content = (
      <SessionArtifactsTab
        worktreeId={target.worktreeId}
        sessionId={target.sessionId}
      />
    )
  } else if (target) {
    content = (
      <GraphTab worktreeId={target.worktreeId} sessionId={target.sessionId} />
    )
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
      data-testid="context-panel"
    >
      <div className="flex items-center gap-1 border-b border-sidebar-border px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-xs font-medium"
            data-testid="context-panel-title"
          >
            {TABS.find(t => t.id === tab)?.label}
          </h2>
          <PanelSubtitle
            tab={tab}
            pinnedElsewhere={
              !!pinnedNetworkId && pinnedNetworkId !== currentSessionId
            }
          />
        </div>
        {tab === 'files' && <FileBrowserRefreshButton />}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => useUIStore.getState().setFileBrowserVisible(false)}
          aria-label="Close side panel"
          title="Close"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div
        role="tablist"
        aria-label="Side panel"
        // A narrow panel wraps the tabs onto a second line; names stay whole.
        className="flex flex-wrap items-center gap-0.5 border-b border-sidebar-border px-1.5 py-1"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const selected = id === tab
          const tabReason = reasons[id]
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`context-panel-tab-${id}`}
              aria-selected={selected}
              aria-disabled={tabReason ? true : undefined}
              title={tabReason ?? label}
              data-testid={`context-panel-tab-${id}`}
              onClick={() => {
                if (tabReason) return
                useUIStore.getState().setContextPanelTab(id)
              }}
              className={cn(
                'flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium',
                selected
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground',
                tabReason
                  ? 'cursor-default opacity-50'
                  : !selected &&
                      'hover:bg-sidebar-accent/70 hover:text-foreground'
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
              {id === 'network' && networkSessionId && (
                <NetworkCount sessionId={networkSessionId} />
              )}
              {id === 'graph' && target && (
                <GraphCount
                  worktreeId={target.worktreeId}
                  sessionId={target.sessionId}
                />
              )}
              {id === 'artifacts' && target && (
                <ArtifactCount
                  worktreeId={target.worktreeId}
                  sessionId={target.sessionId}
                />
              )}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        aria-labelledby={`context-panel-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {content}
      </div>
    </div>
  )
}

/** Count badge of a tab; nothing for zero. */
function TabCount({
  count,
  label,
  testId,
}: {
  count: number
  label: string
  testId: string
}) {
  if (count === 0) return null
  return (
    <Badge
      variant="secondary"
      data-testid={testId}
      aria-label={`${count} ${label}`}
      className="h-4 min-w-4 rounded-full px-1 text-[10px] leading-none tabular-nums"
    >
      {count > 99 ? '99+' : count}
    </Badge>
  )
}

/** Artifacts tab: the session's artifacts. */
function ArtifactCount({
  worktreeId,
  sessionId,
}: {
  worktreeId: string
  sessionId: string
}) {
  const { artifacts } = useSessionArtifacts(worktreeId, sessionId)
  return (
    <TabCount
      count={artifacts.length}
      label="artifacts"
      testId="artifacts-tab-count"
    />
  )
}

/** Network tab: the other sessions in the network. */
function NetworkCount({ sessionId }: { sessionId: string }) {
  const { data: network } = useSessionNetwork(sessionId)
  return (
    <TabCount
      count={Math.max(0, (network?.nodes.length ?? 0) - 1)}
      label="linked sessions"
      testId="network-tab-count"
    />
  )
}

/** Graph tab: the graph nodes the session serves. */
function GraphCount({
  worktreeId,
  sessionId,
}: {
  worktreeId: string
  sessionId: string
}) {
  const session = useTargetSession(worktreeId, sessionId)
  return (
    <TabCount
      count={session?.serves?.length ?? 0}
      label="graph nodes"
      testId="graph-tab-count"
    />
  )
}

/** Second header line: the folder (Files) or the session (other tabs). */
function PanelSubtitle({
  tab,
  pinnedElsewhere,
}: {
  tab: ContextPanelTab
  /** The Network tab shows another session's network. */
  pinnedElsewhere: boolean
}) {
  const target = useActiveSessionTarget()
  const { rootPath, label: folder } = useFileBrowserRootPath()
  const session = useTargetSession(
    target?.worktreeId ?? null,
    target?.sessionId ?? null
  )
  let text: string | null | undefined
  let title: string | undefined
  if (tab === 'files') {
    text = folder
    title = rootPath ?? undefined
  } else if (!(tab === 'network' && pinnedElsewhere)) {
    text = session?.name
  }
  if (!text) return null
  return (
    <p
      className="truncate text-[0.625rem] text-muted-foreground"
      title={title ?? text}
      data-testid="context-panel-subtitle"
    >
      {text}
    </p>
  )
}

/** The session on screen, from the sessions cache of its worktree. */
function useTargetSession(worktreeId: string | null, sessionId: string | null) {
  const { data: worktree } = useWorktree(worktreeId)
  const { data: sessions } = useSessions(worktreeId, worktree?.path ?? null)
  return sessions?.sessions.find(s => s.id === sessionId)
}

/** The Graph tab: the session graph panel of the session on screen. */
function GraphTab({
  worktreeId,
  sessionId,
}: {
  worktreeId: string
  sessionId: string
}) {
  const session = useTargetSession(worktreeId, sessionId)
  if (!session) {
    return <p className="px-3 py-6 text-sm text-muted-foreground">Loading…</p>
  }
  return <SessionGraphPanel session={session} />
}
