import type { ReactNode } from 'react'
import { FolderTree, Network, Workflow, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileBrowserSidebar } from '@/components/file-browser/FileBrowserSidebar'
import { SessionNetworkTree } from '@/components/chat/SessionNetworkTree'
import { SessionGraphPanel } from '@/components/graphs/SessionGraphPanel'
import { useIsMobile } from '@/hooks/use-mobile'
import { useActiveSessionTarget } from '@/lib/session-transfer'
import { cn } from '@/lib/utils'
import { useSessions } from '@/services/chat'
import { useWorktree } from '@/services/projects'
import { useUIStore, type ContextPanelTab } from '@/store/ui-store'

const TABS: { id: ContextPanelTab; label: string; icon: typeof Network }[] = [
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'graph', label: 'Graph', icon: Workflow },
]

/**
 * The left context panel (#98): Files | Network | Graph for the session on
 * screen. Same place, width and visibility (`fileBrowserVisible`) as the
 * file tree before it. The desktop sidebar and the phone drawer both render
 * it; tabs that cannot show anything stay visible but disabled.
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
    content = <FileBrowserSidebar hideCloseButton className="min-h-0 flex-1" />
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
      <div className="flex items-center gap-1 border-b border-sidebar-border px-1.5 py-1">
        <div
          role="tablist"
          aria-label="Side panel"
          className="flex min-w-0 flex-1 items-center gap-0.5"
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
                title={tabReason ?? undefined}
                data-testid={`context-panel-tab-${id}`}
                onClick={() => {
                  if (tabReason) return
                  useUIStore.getState().setContextPanelTab(id)
                }}
                className={cn(
                  'flex h-6 min-w-0 items-center gap-1 rounded-md px-2 text-xs font-medium',
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
                <span className="truncate">{label}</span>
              </button>
            )
          })}
        </div>
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
        role="tabpanel"
        aria-labelledby={`context-panel-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {content}
      </div>
    </div>
  )
}

/** The Graph tab: the session graph panel of the session on screen. */
function GraphTab({
  worktreeId,
  sessionId,
}: {
  worktreeId: string
  sessionId: string
}) {
  const { data: worktree } = useWorktree(worktreeId)
  const { data: sessions } = useSessions(worktreeId, worktree?.path ?? null)
  const session = sessions?.sessions.find(s => s.id === sessionId)
  if (!session) {
    return <p className="px-3 py-6 text-sm text-muted-foreground">Loading…</p>
  }
  return <SessionGraphPanel session={session} />
}
