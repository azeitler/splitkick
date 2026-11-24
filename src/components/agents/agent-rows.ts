import {
  computeSessionCardData,
  isActionableWaitingStatus,
  type ChatStoreState,
  type SessionStatus,
} from '@/components/chat/session-card-utils'
import type { Agent } from '@/types/agents'
import type { AllSessionsEntry } from '@/types/chat'

export interface AgentGroup {
  key: string
  title: string
  agents: Agent[]
}

/**
 * The groups of the Agents tab: "Global" first, then one group per project
 * that has agents, in the sidebar's project order. A project that is not in
 * `projectOrder` (not loaded yet) sorts last.
 */
export function groupAgents(
  agents: readonly Agent[],
  projectOrder: readonly string[]
): AgentGroup[] {
  const groups: AgentGroup[] = []
  const global = agents.filter(agent => agent.scope === 'global')
  if (global.length > 0) {
    groups.push({ key: 'global', title: 'Global', agents: global })
  }

  const byProject = new Map<string, Agent[]>()
  for (const agent of agents) {
    if (agent.scope !== 'project' || !agent.projectId) continue
    byProject.set(agent.projectId, [
      ...(byProject.get(agent.projectId) ?? []),
      agent,
    ])
  }
  const rank = (id: string) => {
    const index = projectOrder.indexOf(id)
    return index === -1 ? projectOrder.length : index
  }
  for (const id of [...byProject.keys()].sort((a, b) => rank(a) - rank(b))) {
    const list = byProject.get(id) ?? []
    groups.push({
      key: id,
      title: list[0]?.projectName ?? 'Project',
      agents: list,
    })
  }
  return groups
}

/** `~/splitkick/agents/<name>`, as the backend names a new agent's folder. */
export function defaultAgentFolder(name: string): string {
  const dir = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]/gu, '-')
  return `~/splitkick/agents/${dir}`
}

/** Statuses of a session whose run works right now. */
const RUNNING_STATUSES: readonly SessionStatus[] = [
  'planning',
  'vibing',
  'yoloing',
  'reviewing',
]

export interface AgentActivity {
  /** Agents whose current session runs and does not wait. */
  running: number
  /** Agents whose current session waits for the user. */
  waiting: number
}

/**
 * How many agents work now, by the status their current session shows in
 * the Agents tab (`computeSessionCardData`), so the nav badge and the tab
 * always agree. That status also knows runs this window did not start (a
 * detached run, one resumed after a restart) and runs that pause for a
 * question, which the bare "sending" flag does not.
 */
export function agentActivity(
  agents: readonly Agent[],
  entries: readonly AllSessionsEntry[],
  storeState: ChatStoreState
): AgentActivity {
  const wanted = new Set(
    agents.flatMap(agent => (agent.sessionId ? [agent.sessionId] : []))
  )
  const activity: AgentActivity = { running: 0, waiting: 0 }
  if (wanted.size === 0) return activity
  for (const entry of entries) {
    for (const session of entry.sessions) {
      if (!wanted.has(session.id) || session.archived_at) continue
      const { status } = computeSessionCardData(session, storeState)
      if (isActionableWaitingStatus(status)) activity.waiting += 1
      else if (RUNNING_STATUSES.includes(status)) activity.running += 1
    }
  }
  return activity
}

/** The nav's words for an `AgentActivity`, or undefined when nothing runs. */
export function agentActivityText(activity: AgentActivity): string | undefined {
  const parts = [
    activity.running > 0 ? `${activity.running} running` : null,
    activity.waiting > 0 ? `${activity.waiting} waiting for you` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : undefined
}
