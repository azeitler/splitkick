import { useCallback, useEffect, useMemo, useRef } from 'react'
import { confirmRemoveAgent } from '@/lib/destructive-confirms'
import { Archive, BotMessageSquare, X } from 'lucide-react'
import { groupAgents } from '@/components/agents/agent-rows'
import { SidebarSectionRow } from '@/components/chat/SidebarSectionRow'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { computeSessionCardData } from '@/components/chat/session-card-utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from '@/components/chat/SessionShortcutRows'
import { useIsMobile } from '@/hooks/use-mobile'
import { navigateToSession } from '@/lib/navigate-to-session'
import { formatMessageTimestamp, formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { useAgents, useRemoveAgent, useRestartAgent } from '@/services/agents'
import { useAllSessions, useUnarchiveSession } from '@/services/chat'
import { useProjects } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { Agent } from '@/types/agents'
import type { Session } from '@/types/chat'
import { SectionNewButton } from './SectionNewButton'
import { SidebarTabEmpty } from './SidebarTabEmpty'
import { useSidebarActiveSessionId } from './useSidebarActiveSessionId'

const openNewAgent = () => useUIStore.getState().setAgentDialog({ mode: 'new' })

/** A session of an agent as it was found in the all-sessions list. */
interface FoundSession {
  projectId: string
  worktreeId: string
  worktreePath: string
  worktreeName: string
  session: Session
}

/** An archived past session: not a normal row, it opens by restoring it. */
interface ArchivedPast {
  sessionId: string
  name: string
  projectId: string
  worktreeId: string
  worktreePath: string
  archivedAt: number
}

/** Guide line under the agent glyph (12 + 7), like a workspace's list. */
const AGENT_SESSION_LIST = 'ml-[18px] border-l border-border/40'

/** Guide line under the current session's status dot, for its children. */
const AGENT_CHILD_LIST = 'ml-[14px] border-l border-border/40'

/** "6d ago · 2 children": a past session tells how many it started. */
function pastContext(updatedAt: number, children: number): string {
  const ago = formatRelativeTime(updatedAt)
  if (children === 0) return ago
  return `${ago} · ${children} ${children === 1 ? 'child' : 'children'}`
}

/**
 * The sidebar's Agents tab: every agent, global ones first, then by project.
 *
 * An agent is one named session in a role. Each agent is an expandable row
 * (expanded by default): under it, its current session, then its past
 * sessions newest first (`pastSessionIds`, the sessions earlier restarts
 * left behind). Session rows carry the same context menu as anywhere else
 * (there: Rename Agent, Agent Role, Remove Agent). A past session that was
 * archived opens by restoring it; one that was deleted, or sits in an
 * archived workspace, is not in the all-sessions list and is left out. An
 * agent whose session was archived or deleted shows "No session".
 */
export function SidebarAgentsSection() {
  const { data: agents = [], refetch: refetchAgents } = useAgents()
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

  // Every session an agent holds or held, archived ones included.
  const foundSessions = useMemo(() => {
    const wanted = new Set<string>()
    for (const agent of agents) {
      if (agent.sessionId) wanted.add(agent.sessionId)
      for (const id of agent.pastSessionIds) wanted.add(id)
    }
    const map = new Map<string, FoundSession>()
    for (const entry of data?.entries ?? []) {
      for (const session of entry.sessions) {
        if (!wanted.has(session.id)) continue
        map.set(session.id, {
          projectId: entry.project_id,
          worktreeId: entry.worktree_id,
          worktreePath: entry.worktree_path,
          worktreeName: entry.worktree_name,
          session,
        })
      }
    }
    return map
  }, [agents, data?.entries])

  // Sessions an agent session started (`started_by_session_id`, the links of
  // the session network), newest first. Archived children are left out.
  const childrenByParent = useMemo(() => {
    const parents = new Set<string>()
    for (const agent of agents) {
      if (agent.sessionId) parents.add(agent.sessionId)
      for (const id of agent.pastSessionIds) parents.add(id)
    }
    const map = new Map<string, FoundSession[]>()
    for (const entry of data?.entries ?? []) {
      for (const session of entry.sessions) {
        const parent = session.started_by_session_id
        if (!parent || !parents.has(parent) || session.archived_at) continue
        const list = map.get(parent) ?? []
        list.push({
          projectId: entry.project_id,
          worktreeId: entry.worktree_id,
          worktreePath: entry.worktree_path,
          worktreeName: entry.worktree_name,
          session,
        })
        map.set(parent, list)
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.session.updated_at - a.session.updated_at)
    }
    return map
  }, [agents, data?.entries])

  const toShortcut = useCallback(
    (found: FoundSession, context: string): SessionShortcut => ({
      sessionId: found.session.id,
      projectId: found.projectId,
      worktreeId: found.worktreeId,
      worktreePath: found.worktreePath,
      session: found.session,
      card: computeSessionCardData(found.session, storeState),
      context,
    }),
    [storeState]
  )

  const currentBySession = useMemo(() => {
    const map = new Map<string, SessionShortcut>()
    for (const agent of agents) {
      const found = agent.sessionId
        ? foundSessions.get(agent.sessionId)
        : undefined
      if (!found || found.session.archived_at) continue
      map.set(found.session.id, toShortcut(found, 'current'))
    }
    return map
  }, [agents, foundSessions, toShortcut])
  // An agent that points at a session the loaded list does not have: the
  // session was archived or deleted by a path that did not tell the agents
  // (a deleted worktree). Listing the agents again heals the pointer in the
  // backend, and the row then shows "No session" with Restart. Asked once
  // per set of such pointers, so a session list that is only late cannot
  // make this loop.
  const stalePointers = useMemo(
    () =>
      data
        ? agents
            .filter(a => a.sessionId && !currentBySession.has(a.sessionId))
            .map(a => `${a.id}:${a.sessionId}`)
            .join(',')
        : '',
    [agents, data, currentBySession]
  )
  const askedFor = useRef('')
  useEffect(() => {
    if (!stalePointers || askedFor.current === stalePointers) return
    askedFor.current = stalePointers
    void refetchAgents()
  }, [stalePointers, refetchAgents])

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
      {groups.map(group => (
        <section key={group.key} className="pb-1">
          <h3
            data-testid="sidebar-agents-group"
            className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70"
          >
            {group.title}
          </h3>
          {group.agents.map(agent => {
            const past: SessionShortcut[] = []
            const archived: ArchivedPast[] = []
            for (const id of agent.pastSessionIds) {
              const found = foundSessions.get(id)
              if (!found) continue
              const { session } = found
              if (session.archived_at) {
                archived.push({
                  sessionId: session.id,
                  name: session.name,
                  projectId: found.projectId,
                  worktreeId: found.worktreeId,
                  worktreePath: found.worktreePath,
                  archivedAt: session.archived_at,
                })
              } else {
                past.push(
                  toShortcut(
                    found,
                    pastContext(
                      session.updated_at,
                      childrenByParent.get(session.id)?.length ?? 0
                    )
                  )
                )
              }
            }
            return (
              <AgentItem
                key={agent.id}
                agent={agent}
                current={
                  agent.sessionId
                    ? currentBySession.get(agent.sessionId)
                    : undefined
                }
                currentChildren={(agent.sessionId
                  ? (childrenByParent.get(agent.sessionId) ?? [])
                  : []
                ).map(child =>
                  toShortcut(
                    child,
                    formatRelativeTime(child.session.updated_at)
                  )
                )}
                past={past}
                archived={archived}
                activeSessionId={activeSessionId}
                onOpen={handleOpen}
              />
            )
          })}
        </section>
      ))}
    </div>
  )
}

/**
 * One agent: a row that opens and closes, then its current session with the
 * sessions it started (indented), then its past sessions. Children of past
 * sessions are only counted on their row ("2 children"); the session network
 * shows them. The open state is per agent and persisted
 * (`collapsedAgentIds`; agents start open).
 */
function AgentItem({
  agent,
  current,
  currentChildren,
  past,
  archived,
  activeSessionId,
  onOpen,
}: {
  agent: Agent
  current: SessionShortcut | undefined
  currentChildren: SessionShortcut[]
  past: SessionShortcut[]
  archived: ArchivedPast[]
  activeSessionId: string | null
  onOpen: (shortcut: SessionShortcut) => void
}) {
  const collapsed = useProjectsStore(state =>
    state.collapsedAgentIds.has(agent.id)
  )
  const handleToggle = useCallback(() => {
    useProjectsStore.getState().toggleAgentCollapsed(agent.id)
  }, [agent.id])
  const hasSession = agent.sessionId !== null
  const count = (current ? 1 : 0) + past.length + archived.length

  return (
    <div
      data-testid={
        !hasSession
          ? 'sidebar-agent-no-session'
          : current
            ? 'sidebar-agent'
            : 'sidebar-agent-pending'
      }
    >
      <SidebarSectionRow
        icon={
          <BotMessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
        }
        label={agent.name}
        count={count}
        expanded={!collapsed}
        onToggle={handleToggle}
        actions={hasSession ? undefined : <NoSessionActions agent={agent} />}
        className="pl-3"
        testId="sidebar-agent-toggle"
      />
      {!collapsed && count > 0 && (
        <div
          className={cn('py-0.5', AGENT_SESSION_LIST)}
          data-testid="sidebar-agent-sessions"
        >
          {current && (
            <SessionShortcutRows
              shortcuts={[current]}
              variant="sidebar"
              showAgentBadge={false}
              activeSessionId={activeSessionId}
              onOpen={onOpen}
            />
          )}
          {current && currentChildren.length > 0 && (
            <div
              className={cn('py-0.5', AGENT_CHILD_LIST)}
              data-testid="sidebar-agent-children"
            >
              <SessionShortcutRows
                shortcuts={currentChildren}
                variant="sidebar"
                activeSessionId={activeSessionId}
                onOpen={onOpen}
              />
            </div>
          )}
          {past.length > 0 && (
            <SessionShortcutRows
              shortcuts={past}
              variant="sidebar"
              showAgentBadge={false}
              activeSessionId={activeSessionId}
              onOpen={onOpen}
            />
          )}
          {archived.map(item => (
            <ArchivedPastRow key={item.sessionId} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

/** "No session" with Restart and Remove, beside the agent's toggle. */
function NoSessionActions({ agent }: { agent: Agent }) {
  const removeAgent = useRemoveAgent()
  const restartAgent = useRestartAgent()
  return (
    <>
      <span className="shrink-0 text-[10px] text-muted-foreground/70">
        No session
      </span>
      <button
        type="button"
        title="Start the agent again in a fresh session"
        onClick={() => restartAgent.mutate({ agentId: agent.id })}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent-foreground/10"
      >
        Restart
      </button>
      <button
        type="button"
        aria-label={`Remove agent ${agent.name}`}
        title="Remove agent"
        onClick={() =>
          void confirmRemoveAgent(agent.name).then(
            ok => ok && removeAgent.mutate({ agentId: agent.id })
          )
        }
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent-foreground/10 hover:text-foreground"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </>
  )
}

/** A past session that was archived: a click restores it and opens it. */
function ArchivedPastRow({ item }: { item: ArchivedPast }) {
  const unarchive = useUnarchiveSession()
  const isMobile = useIsMobile()
  const handleClick = useCallback(async () => {
    try {
      await unarchive.mutateAsync({
        worktreeId: item.worktreeId,
        worktreePath: item.worktreePath,
        sessionId: item.sessionId,
      })
    } catch {
      return // the mutation shows the error toast
    }
    navigateToSession({
      projectId: item.projectId,
      worktreeId: item.worktreeId,
      sessionId: item.sessionId,
    })
    if (isMobile) useUIStore.getState().setLeftSidebarVisible(false)
  }, [item, unarchive, isMobile])

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={unarchive.isPending}
      title={`Archived ${formatMessageTimestamp(item.archivedAt)}. Click to restore and open it.`}
      data-testid="sidebar-agent-archived-session"
      className="ml-1 mr-2 flex w-[calc(100%-0.75rem)] items-center gap-1.5 rounded-md py-1 pl-[7px] pr-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
    >
      <Archive className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{item.name || 'Untitled'}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground/70">
        archived {formatRelativeTime(item.archivedAt)}
      </span>
    </button>
  )
}
