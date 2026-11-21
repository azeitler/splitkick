import { describe, expect, it } from 'vitest'
import type { Agent } from '@/types/agents'
import { groupAgents } from './agent-rows'

function agent(
  id: string,
  scope: Agent['scope'],
  projectId: string | null,
  projectName: string | null
): Agent {
  return {
    id,
    name: id,
    scope,
    projectId,
    projectName,
    roleId: null,
    worktreeId: 'w',
    worktreePath: null,
    sessionId: null,
    sessionName: null,
    pastSessionIds: [],
    createdAt: 0,
  }
}

describe('groupAgents', () => {
  it('puts Global first, then the projects in sidebar order', () => {
    const groups = groupAgents(
      [
        agent('x', 'project', 'p2', 'Beta'),
        agent('g', 'global', 'home', 'assistant'),
        agent('y', 'project', 'p1', 'Alpha'),
      ],
      ['p1', 'p2']
    )
    expect(groups.map(g => g.title)).toEqual(['Global', 'Alpha', 'Beta'])
    expect(groups[0]?.agents.map(a => a.id)).toEqual(['g'])
  })

  it('leaves out empty groups and keeps unknown projects last', () => {
    const groups = groupAgents(
      [
        agent('z', 'project', 'gone', 'Gone'),
        agent('y', 'project', 'p1', 'Alpha'),
      ],
      ['p1']
    )
    expect(groups.map(g => g.title)).toEqual(['Alpha', 'Gone'])
  })
})
