import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { getCurrentUIState } from '@/lib/ui-state-snapshot'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { Agent } from '@/types/agents'
import type { AllSessionsEntry, Session } from '@/types/chat'
import { SidebarAgentsSection } from './SidebarAgentsSection'

const mocks = vi.hoisted(() => ({
  agents: [] as Agent[],
  entries: [] as AllSessionsEntry[],
  navigateToSession: vi.fn(),
  remove: vi.fn(),
  restart: vi.fn(),
  refetch: vi.fn(),
  unarchive: vi.fn(),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
  isMobileViewport: () => false,
}))

vi.mock('@/services/agents', () => ({
  useAgents: () => ({ data: mocks.agents, refetch: mocks.refetch }),
  useAgentForSession: (sessionId: string) =>
    mocks.agents.find(a => a.sessionId === sessionId),
  useRemoveAgent: () => ({ mutate: mocks.remove }),
  useUpdateAgent: () => ({ mutate: vi.fn() }),
  useRestartAgent: () => ({ mutate: mocks.restart }),
}))

vi.mock('@/services/projects', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/projects')>()),
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'Splitkick' },
      { id: 'home', name: 'assistant', hidden: true },
    ],
  }),
}))

vi.mock('@/services/chat', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/chat')>()),
  useAllSessions: () => ({ data: { entries: mocks.entries } }),
  useRenameSession: () => ({ mutate: vi.fn() }),
  useArchiveSession: () => ({ mutate: vi.fn() }),
  useCloseSession: () => ({ mutate: vi.fn() }),
  useUnarchiveSession: () => ({
    mutateAsync: mocks.unarchive,
    isPending: false,
  }),
}))

vi.mock('@/lib/navigate-to-session', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/navigate-to-session')>()),
  navigateToSession: mocks.navigateToSession,
}))

function session(id: string, name: string) {
  return {
    id,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
  } as unknown as Session
}

/** Add sessions to the first workspace (`w1`, project `p1`). */
function addSessions(...sessions: Session[]) {
  mocks.entries[0]?.sessions.push(...sessions)
}

function agent(extra: Partial<Agent>): Agent {
  return {
    id: 'a1',
    name: 'Release manager',
    scope: 'project',
    projectId: 'p1',
    projectName: 'Splitkick',
    roleId: null,
    worktreeId: 'w1',
    worktreePath: '/tmp/w1',
    sessionId: 's1',
    sessionName: 'release work',
    pastSessionIds: [],
    createdAt: 0,
    ...extra,
  }
}

describe('SidebarAgentsSection', () => {
  beforeEach(() => {
    mocks.navigateToSession.mockClear()
    mocks.remove.mockClear()
    mocks.restart.mockClear()
    mocks.refetch.mockClear()
    mocks.unarchive.mockReset()
    mocks.agents = []
    mocks.entries = [
      {
        project_id: 'p1',
        project_name: 'Splitkick',
        worktree_id: 'w1',
        worktree_name: 'main',
        worktree_path: '/tmp/w1',
        sessions: [session('s1', 'release work')],
      },
      {
        project_id: 'home',
        project_name: 'assistant',
        worktree_id: 'w2',
        worktree_name: 'assistant',
        worktree_path: '/tmp/assistant',
        sessions: [session('s2', 'Assistant')],
      },
    ] as AllSessionsEntry[]
    useProjectsStore.setState({
      collapsedAgentIds: new Set(),
      starredSessions: [],
      projectCanvasSettings: {},
    })
    useChatStore.setState({ sessionLabels: {}, activeSessionIds: {} })
    useUIStore.setState({ agentDialog: null })
  })

  it('shows the empty state with a New agent button', async () => {
    render(<SidebarAgentsSection />)
    expect(screen.getByTestId('sidebar-agents-empty')).toHaveTextContent(
      'No agents yet'
    )
    await userEvent.click(screen.getByRole('button', { name: 'New agent' }))
    expect(useUIStore.getState().agentDialog).toEqual({ mode: 'new' })
  })

  it('groups global agents first, then by project, and opens the session', async () => {
    mocks.agents = [
      agent({}),
      agent({
        id: 'a2',
        name: 'Assistant',
        scope: 'global',
        projectId: 'home',
        projectName: 'assistant',
        worktreeId: 'w2',
        sessionId: 's2',
        sessionName: 'Assistant',
      }),
    ]
    render(<SidebarAgentsSection />)
    const headers = screen
      .getAllByTestId('sidebar-agents-group')
      .map(el => el.textContent)
    expect(headers).toEqual(['Global', 'Splitkick'])

    await userEvent.click(screen.getByText('release work'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's1',
    })
  })

  it('shows an agent without a session, with a way to remove it', async () => {
    mocks.agents = [agent({ sessionId: null, sessionName: null })]
    render(<SidebarAgentsSection />)
    const row = screen.getByTestId('sidebar-agent-no-session')
    expect(row).toHaveTextContent('Release manager')
    expect(row).toHaveTextContent('No session')
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove agent Release manager' })
    )
    expect(mocks.remove).toHaveBeenCalledWith({ agentId: 'a1' })
  })

  // The session was archived by a path that did not tell the agents (a
  // deleted worktree): the row must not stay a name without any action.
  it('asks for fresh agents when an agent points at a session that is gone', () => {
    mocks.agents = [agent({ sessionId: 'gone', sessionName: 'old' })]
    render(<SidebarAgentsSection />)
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it('does not ask again while every agent session is in the list', () => {
    mocks.agents = [agent({})]
    render(<SidebarAgentsSection />)
    expect(mocks.refetch).not.toHaveBeenCalled()
  })

  it('restarts an agent that has no session', async () => {
    mocks.agents = [agent({ sessionId: null, sessionName: null })]
    render(<SidebarAgentsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(mocks.restart).toHaveBeenCalledWith({ agentId: 'a1' })
  })

  it('lists the current session, then past sessions, under the agent', () => {
    addSessions(session('old1', 'first run'), session('old2', 'second run'))
    mocks.agents = [agent({ pastSessionIds: ['old2', 'old1', 'deleted'] })]
    render(<SidebarAgentsSection />)
    const list = screen.getByTestId('sidebar-agent-sessions')
    const names = ['release work', 'second run', 'first run']
    const text = list.textContent ?? ''
    const positions = names.map(name => text.indexOf(name))
    expect(positions.every(pos => pos >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    // A deleted past session is not in the list and leaves no row.
    expect(screen.queryByText('deleted')).not.toBeInTheDocument()
  })

  it('collapses an agent and shows the session count instead', async () => {
    addSessions(session('old1', 'first run'))
    mocks.agents = [agent({ pastSessionIds: ['old1'] })]
    render(<SidebarAgentsSection />)
    await userEvent.click(screen.getByTestId('sidebar-agent-toggle'))
    expect(screen.queryByTestId('sidebar-agent-sessions')).toBeNull()
    expect(screen.getByTestId('collapsed-count-badge')).toHaveTextContent('2')
    expect(getCurrentUIState().collapsed_agent_ids).toEqual(['a1'])
  })

  it('opens a past session', async () => {
    addSessions(session('old1', 'first run'))
    mocks.agents = [agent({ pastSessionIds: ['old1'] })]
    render(<SidebarAgentsSection />)
    await userEvent.click(screen.getByText('first run'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 'old1',
    })
  })

  it('restores an archived past session before it opens it', async () => {
    addSessions({
      ...session('old1', 'first run'),
      archived_at: 1,
    } as Session)
    mocks.agents = [agent({ pastSessionIds: ['old1'] })]
    mocks.unarchive.mockResolvedValue({})
    render(<SidebarAgentsSection />)
    await userEvent.click(screen.getByTestId('sidebar-agent-archived-session'))
    expect(mocks.unarchive).toHaveBeenCalledWith({
      worktreeId: 'w1',
      worktreePath: '/tmp/w1',
      sessionId: 'old1',
    })
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 'old1',
    })
  })

  it('keeps past sessions reachable when the agent has no session', () => {
    addSessions(session('old1', 'first run'))
    mocks.agents = [
      agent({ sessionId: null, sessionName: null, pastSessionIds: ['old1'] }),
    ]
    render(<SidebarAgentsSection />)
    expect(screen.getByTestId('sidebar-agent-no-session')).toHaveTextContent(
      'No session'
    )
    expect(screen.getByText('first run')).toBeInTheDocument()
  })

  it('lists the sessions the current session started under it, newest first', async () => {
    addSessions(
      {
        ...session('c1', 'older child'),
        started_by_session_id: 's1',
        updated_at: 10,
      } as Session,
      {
        ...session('c2', 'newer child'),
        started_by_session_id: 's1',
        updated_at: 20,
      } as Session,
      {
        ...session('c3', 'archived child'),
        started_by_session_id: 's1',
        archived_at: 5,
      } as Session
    )
    mocks.agents = [agent({})]
    render(<SidebarAgentsSection />)
    const children = screen.getByTestId('sidebar-agent-children')
    const text = children.textContent ?? ''
    expect(text.indexOf('newer child')).toBeLessThan(
      text.indexOf('older child')
    )
    expect(text).not.toContain('archived child')

    await userEvent.click(screen.getByText('newer child'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 'c2',
    })
  })

  it('counts the children of a past session instead of listing them', () => {
    addSessions(session('old1', 'first run'), {
      ...session('c1', 'child of old'),
      started_by_session_id: 'old1',
    } as Session)
    mocks.agents = [agent({ pastSessionIds: ['old1'] })]
    render(<SidebarAgentsSection />)
    expect(screen.queryByTestId('sidebar-agent-children')).toBeNull()
    expect(screen.queryByText('child of old')).toBeNull()
    expect(screen.getByTestId('sidebar-agent-sessions')).toHaveTextContent(
      '1 child'
    )
  })

  it('does not repeat the agent name as a badge under the agent', () => {
    mocks.agents = [agent({})]
    render(<SidebarAgentsSection />)
    expect(screen.queryByTestId('agent-name-badge')).toBeNull()
  })
})
