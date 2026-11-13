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
import {
  focusedNetworkRows,
  networkDepths,
  SessionNetworkTree,
} from './SessionNetworkTree'

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

describe('focusedNetworkRows', () => {
  const rowsOf = (focusId: string) =>
    focusedNetworkRows(tree, focusId).map(({ node, depth }) => [
      node.session.id,
      depth,
    ])

  it('shows the parent as one row, then the session and its children', () => {
    expect(rowsOf('a')).toEqual([
      ['root', 0],
      ['a', 1],
      ['a1', 2],
    ])
  })

  it('leaves out siblings and the rest of the parent tree', () => {
    expect(rowsOf('a1')).toEqual([
      ['a', 0],
      ['a1', 1],
    ])
  })

  it('starts at the session itself when it has no parent', () => {
    expect(rowsOf('root')).toEqual([
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

  it('lists the parent, this session and its children, not siblings', () => {
    render(<SessionNetworkTree sessionId="a" currentSessionId="a" />)
    expect(screen.getByText('Session root')).toBeInTheDocument()
    expect(screen.getByText('Session a1')).toBeInTheDocument()
    expect(screen.getByText('Demo › tree-a1')).toBeInTheDocument()
    expect(screen.getByText('This session')).toBeInTheDocument()
    expect(screen.queryByText('Session b')).toBeNull()
  })

  it('says when this session has started no other sessions', () => {
    render(<SessionNetworkTree sessionId="a1" currentSessionId="a1" />)
    expect(
      screen.getByText('This session has not started other sessions.')
    ).toBeInTheDocument()
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
    render(<SessionNetworkTree sessionId="root" currentSessionId="root" />)
    const row = screen.getByText('Session b').closest('button')
    expect(row).toBeDisabled()
    expect(row?.textContent).toContain('Archived')
  })

  it('says when the root was started by a session not on this device', () => {
    network.current = { ...tree, rootParentMissing: true }
    render(<SessionNetworkTree sessionId="root" currentSessionId="root" />)
    expect(
      screen.getByText('Started by a session that is not on this device.')
    ).toBeInTheDocument()
  })
})
