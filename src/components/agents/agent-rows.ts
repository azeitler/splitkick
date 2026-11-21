import type { Agent } from '@/types/agents'

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
