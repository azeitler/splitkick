import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  openSplitkickLink,
  parseSplitkickLink,
  splitkickLink,
  splitkickMarkdownLink,
  type SplitkickLinkTarget,
} from './splitkick-links'
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
})
