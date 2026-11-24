import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  openSplitkickLink,
  parseSplitkickLink,
  splitkickLink,
  splitkickMarkdownLink,
  type SplitkickLinkTarget,
} from './splitkick-links'
import { activateConnection } from './connection-windows'
import {
  navigateToProject,
  navigateToSession,
  navigateToWorktree,
} from './navigate-to-session'

vi.mock('./navigate-to-session', () => ({
  navigateToSession: vi.fn(),
  navigateToWorktree: vi.fn(),
  navigateToProject: vi.fn(),
}))
const connections = vi.hoisted(() => ({ list: [] as { id: string }[] }))
vi.mock('./remote-connections', () => ({
  getRemoteConnections: () => connections.list,
}))
vi.mock('./connection-windows', () => ({
  activateConnection: vi.fn(() => Promise.resolve()),
}))
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

function target(
  overrides: Partial<SplitkickLinkTarget> = {}
): SplitkickLinkTarget {
  return {
    kind: 'session',
    id: 's1',
    name: 'Fix redirects',
    projectId: 'p1',
    projectName: 'jean',
    worktreeId: 'wt1',
    worktreeName: 'fuzzy-tiger',
    worktreePath: '/wt',
    archived: false,
    ...overrides,
  }
}

describe('parseSplitkickLink', () => {
  it('reads the kind and id of each link form', () => {
    expect(parseSplitkickLink('splitkick://session/abc-123')).toEqual({
      kind: 'session',
      id: 'abc-123',
    })
    expect(parseSplitkickLink('splitkick://worktree/w1')).toEqual({
      kind: 'worktree',
      id: 'w1',
    })
    expect(parseSplitkickLink('SPLITKICK://Project/p1/')).toEqual({
      kind: 'project',
      id: 'p1',
    })
  })

  it('reads agent and connection links', () => {
    expect(parseSplitkickLink('splitkick://agent/a1')).toEqual({
      kind: 'agent',
      id: 'a1',
    })
    expect(parseSplitkickLink('splitkick://connection/c1')).toEqual({
      kind: 'connection',
      id: 'c1',
    })
  })

  it('refuses other schemes, unknown kinds and a missing id', () => {
    for (const href of [
      undefined,
      '',
      'https://example.com/session/1',
      'splitkick://folder/1',
      'splitkick://session/',
      'splitkick://session/a/b',
      'docs/session/1',
    ]) {
      expect(parseSplitkickLink(href)).toBeNull()
    }
  })
})

describe('splitkickLink', () => {
  it('builds the link and round-trips through the parser', () => {
    expect(splitkickLink('session', 's1')).toBe('splitkick://session/s1')
    expect(parseSplitkickLink(splitkickLink('worktree', 'w 1'))).toEqual({
      kind: 'worktree',
      id: 'w 1',
    })
  })

  it('builds a markdown link and escapes brackets in the name', () => {
    expect(splitkickMarkdownLink('session', 's1', 'Fix [WIP] redirects')).toBe(
      '[Fix \\[WIP\\] redirects](splitkick://session/s1)'
    )
  })
})

describe('openSplitkickLink', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens a session in the modal', () => {
    openSplitkickLink({ kind: 'session', id: 's1' }, target())
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'wt1',
      sessionId: 's1',
    })
  })

  it('opens a worktree and a project', () => {
    openSplitkickLink(
      { kind: 'worktree', id: 'wt1' },
      target({ kind: 'worktree', id: 'wt1' })
    )
    expect(navigateToWorktree).toHaveBeenCalledWith('p1', 'wt1')

    openSplitkickLink(
      { kind: 'project', id: 'p1' },
      target({ kind: 'project', id: 'p1', worktreeId: null })
    )
    expect(navigateToProject).toHaveBeenCalledWith('p1')
  })

  it('does not navigate to an archived or missing target', () => {
    openSplitkickLink({ kind: 'session', id: 's1' }, target({ archived: true }))
    expect(toast.info).toHaveBeenCalled()

    openSplitkickLink({ kind: 'session', id: 's1' }, null)
    expect(toast.error).toHaveBeenCalled()

    expect(navigateToSession).not.toHaveBeenCalled()
  })

  it("opens an agent's current session", () => {
    openSplitkickLink(
      { kind: 'agent', id: 'a1' },
      target({
        kind: 'agent',
        id: 'a1',
        name: 'Release manager',
        sessionId: 's9',
      })
    )
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'wt1',
      sessionId: 's9',
    })
  })

  it('says an agent without a session has nothing to open', () => {
    openSplitkickLink(
      { kind: 'agent', id: 'a1' },
      target({ kind: 'agent', id: 'a1', sessionId: null })
    )
    expect(navigateToSession).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalled()
  })

  it('opens a connection this client knows, and explains one it does not', () => {
    const connection = target({
      kind: 'connection',
      id: 'c1',
      name: 'Mac 2',
      projectId: '',
      projectName: '',
      worktreeId: null,
      url: 'https://box.tail1234.ts.net',
    })
    connections.list = [{ id: 'c1' }]
    openSplitkickLink({ kind: 'connection', id: 'c1' }, connection)
    expect(activateConnection).toHaveBeenCalledWith('c1')

    connections.list = []
    openSplitkickLink({ kind: 'connection', id: 'c1' }, connection)
    expect(activateConnection).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalled()
  })
})
