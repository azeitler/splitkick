import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChatService from '@/services/chat'
import { linkedSessionIds } from '@/services/chat'
import { useUIStore } from '@/store/ui-store'
import { render } from '@/test/test-utils'
import type {
  AllSessionsResponse,
  Session,
  SessionNetwork,
  SessionNetworkNode,
} from '@/types/chat'
import { networkDepths, SessionNetworkTree } from './SessionNetworkTree'

const network = vi.hoisted(() => ({
  current: undefined as SessionNetwork | null | undefined,
}))
const navigateToSession = vi.hoisted(() => vi.fn())

vi.mock('@/services/chat', async importOriginal => ({
  ...(await importOriginal<typeof ChatService>()),
  useSessionNetwork: () => ({
    data: network.current,
    isLoading: network.current === undefined,
    isError: false,
  }),
}))

vi.mock('@/lib/navigate-to-session', () => ({ navigateToSession }))

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: `Session ${id}`,
    order: 0,
    created_at: 0,
    updated_at: 0,
    messages: [],
    backend: 'claude',
    ...overrides,
  } as Session
}

function node(
  id: string,
  parentId: string | null,
  overrides: Partial<SessionNetworkNode> = {}
): SessionNetworkNode {
  return {
    session: session(id, { started_by_session_id: parentId }),
    parentId,
    projectId: 'p1',
    projectName: 'Demo',
    worktreeId: `wt-${id}`,
    worktreeName: `tree-${id}`,
    worktreePath: `/w/${id}`,
    worktreeArchived: false,
    ...overrides,
  }
}

const tree: SessionNetwork = {
  rootId: 'root',
  rootParentMissing: false,
  nodes: [
    node('root', null),
    node('a', 'root'),
    node('a1', 'a'),
    node('b', 'root', { worktreeArchived: true }),
  ],
}

describe('networkDepths', () => {
  it('indents each node one level below its parent', () => {
    const depths = networkDepths(tree)
    expect([...depths.entries()]).toEqual([
      ['root', 0],
      ['a', 1],
      ['a1', 2],
      ['b', 1],
    ])
  })
})

describe('linkedSessionIds', () => {
  it('holds parents and children, not unlinked sessions', () => {
    const data = {
      entries: [
        {
          project_id: 'p',
          project_name: 'P',
          worktree_id: 'w',
          worktree_name: 'W',
          worktree_path: '/w',
          sessions: [
            session('parent'),
            session('child', { started_by_session_id: 'parent' }),
            session('lone'),
          ],
        },
      ],
    } as AllSessionsResponse
    const ids = linkedSessionIds(data)
    expect(ids.has('parent')).toBe(true)
    expect(ids.has('child')).toBe(true)
    expect(ids.has('lone')).toBe(false)
    expect(linkedSessionIds(data)).toBe(ids)
  })
})

describe('SessionNetworkTree (#77, #98)', () => {
  beforeEach(() => {
    network.current = tree
    navigateToSession.mockClear()
    useUIStore.getState().setSessionNetworkSessionId(null)
  })

  it('lists the whole tree with project › worktree and marks this session', () => {
    render(<SessionNetworkTree sessionId="a" currentSessionId="a" />)
    expect(screen.getByText('Session root')).toBeInTheDocument()
    expect(screen.getByText('Session a1')).toBeInTheDocument()
    expect(screen.getByText('Demo › tree-a1')).toBeInTheDocument()
    expect(screen.getByText('This session')).toBeInTheDocument()
  })

  it('marks no row as this session for a pinned other network', () => {
    render(<SessionNetworkTree sessionId="a" currentSessionId="other" />)
    expect(screen.queryByText('This session')).toBeNull()
  })

  it('opens a session on click and drops the pinned network', () => {
    const onOpened = vi.fn()
    useUIStore.getState().setSessionNetworkSessionId('a')
    render(
      <SessionNetworkTree
        sessionId="a"
        currentSessionId={null}
        onOpened={onOpened}
      />
    )
    fireEvent.click(screen.getByText('Session a1'))
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'wt-a1',
      sessionId: 'a1',
    })
    expect(useUIStore.getState().sessionNetworkSessionId).toBeNull()
    expect(onOpened).toHaveBeenCalled()
  })

  it('shows archived sessions greyed out and not clickable', () => {
    render(<SessionNetworkTree sessionId="a" currentSessionId="a" />)
    const row = screen.getByText('Session b').closest('button')
    expect(row).toBeDisabled()
    expect(row?.textContent).toContain('Archived')
  })

  it('says when the root was started by a session not on this device', () => {
    network.current = { ...tree, rootParentMissing: true }
    render(<SessionNetworkTree sessionId="a" currentSessionId="a" />)
    expect(
      screen.getByText('Started by a session that is not on this device.')
    ).toBeInTheDocument()
  })
})
