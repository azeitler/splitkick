import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
} from 'react'
import { confirmRemoveAgent } from '@/lib/destructive-confirms'
import {
  Archive,
  BotMessageSquare,
  History,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  X,
} from 'lucide-react'
import { groupAgents } from '@/components/agents/agent-rows'
import { SidebarSectionRow } from '@/components/chat/SidebarSectionRow'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { computeSessionCardData } from '@/components/chat/session-card-utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from '@/components/chat/SessionShortcutRows'
import { useIsMobile } from '@/hooks/use-mobile'
import { isNativeApp } from '@/lib/environment'
import { CollapsedCountBadge } from './CollapsedCountBadge'
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

/** The key of a session node in the Agents tab tree. */
export function agentNodeKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`
}

/** Parent session id → the sessions it started, newest first. */
type ChildrenMap = Map<string, FoundSession[]>

/** Every session below `sessionId`. `seen` stops a link loop. */
function countDescendants(
  childrenOf: ChildrenMap,
  sessionId: string,
  seen = new Set<string>([sessionId])
): number {
  let count = 0
  for (const child of childrenOf.get(sessionId) ?? []) {
    if (seen.has(child.session.id)) continue
    seen.add(child.session.id)
    count += 1 + countDescendants(childrenOf, child.session.id, seen)
  }
  return count
}

/** The keys of every node under an agent's current session that has children. */
function parentNodeKeys(
  agentId: string,
  childrenOf: ChildrenMap,
  sessionId: string,
  seen = new Set<string>([sessionId])
): string[] {
  const children = childrenOf.get(sessionId) ?? []
  if (children.length === 0) return []
  const keys = [agentNodeKey(agentId, sessionId)]
  for (const child of children) {
    if (seen.has(child.session.id)) continue
    seen.add(child.session.id)
    keys.push(...parentNodeKeys(agentId, childrenOf, child.session.id, seen))
  }
  return keys
}

/**
 * Left/Right on a focused tree row, as in a macOS outline: Left closes an
 * open row, Right opens a closed one. Desktop app only, like the other
 * keyboard-only affordances.
 */
function outlineKeyHandler(
  enabled: boolean,
  open: boolean,
  toggle: () => void
): ((e: KeyboardEvent) => void) | undefined {
  if (!enabled) return undefined
  return e => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
    if (e.target !== e.currentTarget.querySelector('button')) return
    if ((e.key === 'ArrowLeft' && open) || (e.key === 'ArrowRight' && !open)) {
      e.preventDefault()
      toggle()
    }
  }
}

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

  // Sessions another session started (`started_by_session_id`, the links of
  // the session network), newest first, so the tree can nest them. Archived
  // children are left out.
  const childrenByParent = useMemo(() => {
    const map: ChildrenMap = new Map()
    if (agents.length === 0) return map
    for (const entry of data?.entries ?? []) {
      for (const session of entry.sessions) {
        const parent = session.started_by_session_id
        if (!parent || session.archived_at) continue
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
  }, [agents.length, data?.entries])

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
      map.set(found.session.id, {
        ...toShortcut(found, ''),
        label: agent.name,
      })
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

  // Collapse all / Expand all. "Expand all" once everything is closed.
  const allCollapsed = useProjectsStore(state =>
    agents.every(agent => state.collapsedAgentIds.has(agent.id))
  )
  const handleCollapseAll = useCallback(() => {
    const { setAgentTreeCollapsed } = useProjectsStore.getState()
    if (allCollapsed) {
      // Everything open, the Previous Sessions groups too.
      setAgentTreeCollapsed(
        [],
        [],
        agents.filter(a => a.pastSessionIds.length > 0).map(a => a.id)
      )
      return
    }
    // The children of the current session are the agent row's own list, so
    // the agent row's state stands for that node; only deeper ones need keys.
    const nodeKeys = agents.flatMap(agent =>
      agent.sessionId
        ? parentNodeKeys(agent.id, childrenByParent, agent.sessionId).filter(
            key => key !== agentNodeKey(agent.id, agent.sessionId ?? '')
          )
        : []
    )
    setAgentTreeCollapsed(
      agents.map(agent => agent.id),
      nodeKeys
    )
  }, [agents, allCollapsed, childrenByParent])

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
      <div className="flex items-center justify-end gap-0.5 px-2 pt-1">
        <button
          type="button"
          onClick={handleCollapseAll}
          aria-label={allCollapsed ? 'Expand all' : 'Collapse all'}
          title={allCollapsed ? 'Expand all' : 'Collapse all'}
          data-testid="sidebar-agents-collapse-all"
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent-foreground/10 hover:text-foreground"
        >
          {allCollapsed ? (
            <ChevronsUpDown className="size-3" aria-hidden="true" />
          ) : (
            <ChevronsDownUp className="size-3" aria-hidden="true" />
          )}
        </button>
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
                childrenOf={childrenByParent}
                toShortcut={toShortcut}
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
 * One agent. The agent row is its current session's row: the status dot,
 * the agent's name, the session's context menu (with the agent items); a
 * click opens the session, only the chevron opens and closes. Under it: the
 * sessions the current session started, each with its own children, then
 * "Previous Sessions" (closed by default): the sessions earlier restarts
 * left behind, newest first, archived ones last. An agent without a session
 * keeps a plain row with "No session" and Restart.
 *
 * Open state is persisted: `collapsedAgentIds` for agent rows (open by
 * default), `collapsedAgentNodeKeys` for deeper session nodes (open),
 * `expandedAgentPreviousIds` for the Previous Sessions group (closed).
 */
function AgentItem({
  agent,
  current,
  childrenOf,
  toShortcut,
  past,
  archived,
  activeSessionId,
  onOpen,
}: {
  agent: Agent
  current: SessionShortcut | undefined
  childrenOf: ChildrenMap
  toShortcut: (found: FoundSession, context: string) => SessionShortcut
  past: SessionShortcut[]
  archived: ArchivedPast[]
  activeSessionId: string | null
  onOpen: (shortcut: SessionShortcut) => void
}) {
  const isMobile = useIsMobile()
  const keys = !isMobile && isNativeApp()
  const collapsed = useProjectsStore(state =>
    state.collapsedAgentIds.has(agent.id)
  )
  const handleToggle = useCallback(() => {
    useProjectsStore.getState().toggleAgentCollapsed(agent.id)
  }, [agent.id])
  const hasSession = agent.sessionId !== null
  const children = current
    ? (childrenOf.get(current.sessionId) ?? []).filter(
        child => child.session.id !== current.sessionId
      )
    : []
  const previousCount = past.length + archived.length
  const hidden =
    (current ? countDescendants(childrenOf, current.sessionId) : 0) +
    previousCount
  const hasChildren = children.length > 0 || previousCount > 0

  const renderAction = useCallback(
    () =>
      hasChildren ? (
        <TreeToggle
          collapsed={collapsed}
          hidden={hidden}
          onToggle={handleToggle}
          label={`${collapsed ? 'Show' : 'Hide'} the sessions of ${agent.name}`}
          testId="sidebar-agent-toggle"
        />
      ) : null,
    [agent.name, collapsed, handleToggle, hasChildren, hidden]
  )

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
      {current ? (
        <div
          onKeyDown={
            hasChildren
              ? outlineKeyHandler(keys, !collapsed, handleToggle)
              : undefined
          }
        >
          <SessionShortcutRows
            shortcuts={[current]}
            variant="sidebar"
            sidebarRowClassName="py-1.5 pl-2 pr-1"
            sidebarNested={false}
            renderAction={renderAction}
            activeSessionId={activeSessionId}
            onOpen={onOpen}
          />
        </div>
      ) : (
        <div onKeyDown={outlineKeyHandler(keys, !collapsed, handleToggle)}>
          <SidebarSectionRow
            icon={
              <BotMessageSquare
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            }
            label={agent.name}
            count={hidden}
            expanded={!collapsed}
            onToggle={handleToggle}
            actions={
              hasSession ? undefined : <NoSessionActions agent={agent} />
            }
            className="pl-3"
            testId="sidebar-agent-toggle"
          />
        </div>
      )}
      {!collapsed && hasChildren && (
        <div
          className={cn('py-0.5', AGENT_SESSION_LIST)}
          data-testid="sidebar-agent-sessions"
        >
          {current && children.length > 0 && (
            <div data-testid="sidebar-agent-children">
              {children.map(child => (
                <AgentSessionNode
                  key={child.session.id}
                  agentId={agent.id}
                  shortcut={toShortcut(
                    child,
                    formatRelativeTime(child.session.updated_at)
                  )}
                  childrenOf={childrenOf}
                  toShortcut={toShortcut}
                  ancestors={new Set([current.sessionId, child.session.id])}
                  activeSessionId={activeSessionId}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
          {previousCount > 0 && (
            <PreviousSessions
              agentId={agent.id}
              past={past}
              archived={archived}
              activeSessionId={activeSessionId}
              onOpen={onOpen}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The toggle at the right edge of a tree row: a chevron while open, the
 * count of hidden sessions while closed.
 */
function TreeToggle({
  collapsed,
  hidden,
  onToggle,
  label,
  testId,
}: {
  collapsed: boolean
  hidden: number
  onToggle: () => void
  label: string
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={label}
      data-testid={testId}
      className="flex h-5 shrink-0 items-center rounded px-0.5 text-muted-foreground hover:bg-accent-foreground/10 hover:text-foreground"
    >
      {collapsed ? (
        <CollapsedCountBadge count={hidden} noun="session" className="ml-0" />
      ) : (
        <ChevronDown
          className="size-3 rotate-180 opacity-60"
          aria-hidden="true"
        />
      )}
    </button>
  )
}

/**
 * "Previous Sessions": the sessions earlier restarts of the agent left
 * behind, newest first, then the archived ones. Closed by default.
 */
function PreviousSessions({
  agentId,
  past,
  archived,
  activeSessionId,
  onOpen,
}: {
  agentId: string
  past: SessionShortcut[]
  archived: ArchivedPast[]
  activeSessionId: string | null
  onOpen: (shortcut: SessionShortcut) => void
}) {
  const isMobile = useIsMobile()
  const open = useProjectsStore(state =>
    state.expandedAgentPreviousIds.has(agentId)
  )
  const handleToggle = useCallback(() => {
    useProjectsStore.getState().toggleAgentPreviousExpanded(agentId)
  }, [agentId])
  const count = past.length + archived.length

  return (
    <div data-testid="sidebar-agent-previous">
      <div
        onKeyDown={outlineKeyHandler(
          !isMobile && isNativeApp(),
          open,
          handleToggle
        )}
      >
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={open}
          data-testid="sidebar-agent-previous-toggle"
          className="group ml-1 mr-2 flex w-[calc(100%-0.75rem)] items-center gap-1.5 rounded-md py-1 pl-[7px] pr-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <History className="size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Previous Sessions</span>
          {open ? (
            <ChevronDown
              className="size-3 shrink-0 rotate-180 opacity-60"
              aria-hidden="true"
            />
          ) : (
            <CollapsedCountBadge count={count} noun="session" />
          )}
        </button>
      </div>
      {open && (
        <div
          className={cn('py-0.5', AGENT_CHILD_LIST)}
          data-testid="sidebar-agent-previous-list"
        >
          {past.length > 0 && (
            <SessionShortcutRows
              shortcuts={past}
              variant="sidebar"
              showAgentBadge={false}
              renderAction={noAction}
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

/** Keeps a row without children aligned with rows that have a toggle. */
const noAction = () => null

/**
 * One session in an agent's tree, and the sessions it started below it.
 * A row with children has a toggle at its right edge: a chevron while open,
 * the count of hidden sessions while closed. A row without keeps the same
 * right padding, so the names line up.
 */
function AgentSessionNode({
  agentId,
  shortcut,
  childrenOf,
  toShortcut,
  ancestors,
  showAgentBadge = true,
  activeSessionId,
  onOpen,
}: {
  agentId: string
  shortcut: SessionShortcut
  childrenOf: ChildrenMap
  toShortcut: (found: FoundSession, context: string) => SessionShortcut
  /** Sessions above this node, so a link loop cannot recurse forever. */
  ancestors: Set<string>
  showAgentBadge?: boolean
  activeSessionId: string | null
  onOpen: (shortcut: SessionShortcut) => void
}) {
  const isMobile = useIsMobile()
  const nodeKey = agentNodeKey(agentId, shortcut.sessionId)
  const collapsed = useProjectsStore(state =>
    state.collapsedAgentNodeKeys.has(nodeKey)
  )
  const handleToggle = useCallback(() => {
    useProjectsStore.getState().toggleAgentNodeCollapsed(nodeKey)
  }, [nodeKey])
  const children = (childrenOf.get(shortcut.sessionId) ?? []).filter(
    child => !ancestors.has(child.session.id)
  )
  const hidden = collapsed
    ? countDescendants(childrenOf, shortcut.sessionId)
    : 0

  const renderAction = useCallback(
    () =>
      children.length === 0 ? null : (
        <TreeToggle
          collapsed={collapsed}
          hidden={hidden}
          onToggle={handleToggle}
          label={`${collapsed ? 'Show' : 'Hide'} sessions started by ${
            shortcut.session.name || 'Untitled'
          }`}
          testId="sidebar-agent-node-toggle"
        />
      ),
    [children.length, collapsed, handleToggle, hidden, shortcut.session.name]
  )

  return (
    <>
      <div
        onKeyDown={
          children.length > 0
            ? outlineKeyHandler(
                !isMobile && isNativeApp(),
                !collapsed,
                handleToggle
              )
            : undefined
        }
      >
        <SessionShortcutRows
          shortcuts={[shortcut]}
          variant="sidebar"
          showAgentBadge={showAgentBadge}
          renderAction={renderAction}
          activeSessionId={activeSessionId}
          onOpen={onOpen}
        />
      </div>
      {!collapsed && children.length > 0 && (
        <div
          className={cn('py-0.5', AGENT_CHILD_LIST)}
          data-testid="sidebar-agent-children"
        >
          {children.map(child => (
            <AgentSessionNode
              key={child.session.id}
              agentId={agentId}
              shortcut={toShortcut(
                child,
                formatRelativeTime(child.session.updated_at)
              )}
              childrenOf={childrenOf}
              toShortcut={toShortcut}
              ancestors={new Set([...ancestors, child.session.id])}
              activeSessionId={activeSessionId}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </>
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
