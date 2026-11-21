import { useCallback, useMemo } from 'react'
import { BotMessageSquare, X } from 'lucide-react'
import { groupAgents } from '@/components/agents/agent-rows'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { computeSessionCardData } from '@/components/chat/session-card-utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from '@/components/chat/SessionShortcutRows'
import { useIsMobile } from '@/hooks/use-mobile'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useAgents, useRemoveAgent } from '@/services/agents'
import { useAllSessions } from '@/services/chat'
import { useProjects } from '@/services/projects'
import { useUIStore } from '@/store/ui-store'
import type { Agent } from '@/types/agents'
import { SectionNewButton } from './SectionNewButton'
import { SidebarTabEmpty } from './SidebarTabEmpty'
import { useSidebarActiveSessionId } from './useSidebarActiveSessionId'

const openNewAgent = () => useUIStore.getState().setAgentDialog({ mode: 'new' })

/**
 * The sidebar's Agents tab: every agent, global ones first, then by project.
 *
 * An agent is one named session in a role. Its row is the row of its current
 * session, with the same context menu as anywhere else (there: Rename Agent,
 * Agent Role, Remove Agent). An agent whose session was archived or deleted
 * shows as "No session". The session rows resolve against the all-sessions
 * cache the other tabs share.
 */
export function SidebarAgentsSection() {
  const { data: agents = [] } = useAgents()
  const { data: projects } = useProjects()
  const isMobile = useIsMobile()
  const { data } = useAllSessions(agents.length > 0)
  const storeState = useCanvasStoreState()
  const activeSessionId = useSidebarActiveSessionId()

  const groups = useMemo(
    () =>
      groupAgents(
        agents,
        (projects ?? []).map(project => project.id)
      ),
    [agents, projects]
  )

  const shortcutsBySession = useMemo(() => {
    const wanted = new Set(agents.map(agent => agent.sessionId))
    const map = new Map<string, SessionShortcut>()
    for (const entry of data?.entries ?? []) {
      for (const session of entry.sessions) {
        if (session.archived_at || !wanted.has(session.id)) continue
        map.set(session.id, {
          sessionId: session.id,
          projectId: entry.project_id,
          worktreeId: entry.worktree_id,
          worktreePath: entry.worktree_path,
          session,
          card: computeSessionCardData(session, storeState),
          context: entry.worktree_name,
        })
      }
    }
    return map
  }, [agents, data?.entries, storeState])

  const handleOpen = useCallback(
    (shortcut: SessionShortcut) => {
      navigateToSession({
        projectId: shortcut.projectId,
        worktreeId: shortcut.worktreeId,
        sessionId: shortcut.sessionId,
      })
      if (isMobile) {
        useUIStore.getState().setLeftSidebarVisible(false)
      }
    },
    [isMobile]
  )

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <SidebarTabEmpty
          icon={<BotMessageSquare />}
          title="No agents yet"
          hint="An agent is one named session in a role. Other sessions can send it work by name."
          testId="sidebar-agents-empty"
        />
        <SectionNewButton label="New agent" onClick={openNewAgent} />
      </div>
    )
  }

  return (
    <div data-testid="sidebar-agents-section">
      <div className="flex items-center justify-end px-2 pt-1">
        <SectionNewButton label="New agent" onClick={openNewAgent} />
      </div>
      {groups.map(group => {
        const shortcuts: SessionShortcut[] = []
        const withoutRow: Agent[] = []
        for (const agent of group.agents) {
          const shortcut = agent.sessionId
            ? shortcutsBySession.get(agent.sessionId)
            : undefined
          if (shortcut) shortcuts.push(shortcut)
          else withoutRow.push(agent)
        }
        return (
          <section key={group.key} className="pb-1">
            <h3
              data-testid="sidebar-agents-group"
              className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70"
            >
              {group.title}
            </h3>
            <SessionShortcutRows
              shortcuts={shortcuts}
              variant="sidebar"
              sidebarRowClassName="py-1.5 pl-2 pr-1"
              sidebarNested={false}
              activeSessionId={activeSessionId}
              onOpen={handleOpen}
            />
            {withoutRow.map(agent => (
              <AgentWithoutRow key={agent.id} agent={agent} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

/**
 * An agent with no session row: its session is gone ("No session"), or the
 * session list has not loaded it yet.
 */
function AgentWithoutRow({ agent }: { agent: Agent }) {
  const removeAgent = useRemoveAgent()
  const hasSession = agent.sessionId !== null
  return (
    <div
      data-testid={
        hasSession ? 'sidebar-agent-pending' : 'sidebar-agent-no-session'
      }
      className="flex items-center gap-1.5 py-1.5 pl-3 pr-1 text-xs"
    >
      <BotMessageSquare
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
      {!hasSession && (
        <>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            No session
          </span>
          <button
            type="button"
            aria-label={`Remove agent ${agent.name}`}
            title="Remove agent"
            onClick={() => removeAgent.mutate({ agentId: agent.id })}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent-foreground/10 hover:text-foreground"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}
