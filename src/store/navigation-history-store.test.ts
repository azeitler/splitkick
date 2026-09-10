import { beforeEach, describe, expect, it } from 'vitest'
import {
  NAVIGATION_ARRIVAL_TIMEOUT_MS,
  isSameLocation,
  useNavigationHistoryStore,
  type NavigationLocation,
} from './navigation-history-store'

const home: NavigationLocation = { kind: 'home' }
const projectA: NavigationLocation = { kind: 'project', projectId: 'a' }
const session1: NavigationLocation = {
  kind: 'session',
  projectId: 'a',
  worktreeId: 'w1',
  sessionId: 's1',
}
const session2: NavigationLocation = { ...session1, sessionId: 's2' }

const history = () => useNavigationHistoryStore.getState()

describe('navigation history store', () => {
  beforeEach(() => {
    useNavigationHistoryStore.setState({
      entries: [],
      index: -1,
      pendingUntil: null,
    })
  })

  it('compares locations by what the user sees', () => {
    expect(isSameLocation(session1, { ...session1, projectId: 'x' })).toBe(true)
    expect(isSameLocation(session1, session2)).toBe(false)
    expect(isSameLocation(projectA, home)).toBe(false)
    expect(
      isSameLocation(
        {
          kind: 'chat',
          projectId: null,
          worktreeId: 'w1',
          worktreePath: '/a',
          sessionId: 's1',
        },
        session1
      )
    ).toBe(false)
  })

  it('records new locations and skips repeats', () => {
    history().record(home, 0)
    history().record(home, 0)
    history().record(projectA, 0)
    expect(history().entries).toEqual([home, projectA])
    expect(history().index).toBe(1)
  })

  it('moves back and forward and returns the target', () => {
    history().record(home, 0)
    history().record(projectA, 0)
    history().record(session1, 0)

    expect(history().go(-1, 0)).toEqual(projectA)
    expect(history().go(-1, 0)).toEqual(home)
    expect(history().go(-1, 0)).toBeNull()
    expect(history().index).toBe(0)
    expect(history().go(1, 0)).toEqual(projectA)
    expect(history().index).toBe(1)
  })

  it('drops forward entries when a new location follows Back', () => {
    history().record(home, 0)
    history().record(projectA, 0)
    history().record(session1, 0)
    history().go(-1, 0)
    history().record(projectA, 10_000) // arrival
    history().record(session2, 10_000)

    expect(history().entries).toEqual([home, projectA, session2])
    expect(history().go(1, 0)).toBeNull()
  })

  it('ignores intermediate states until the target arrives', () => {
    history().record(home, 0)
    history().record(session1, 0)
    history().record(session2, 0)
    history().go(-1, 1000)

    // The replay passes through the project canvas before the modal opens.
    history().record(projectA, 1100)
    expect(history().entries).toEqual([home, session1, session2])
    expect(history().pendingUntil).not.toBeNull()

    history().record(session1, 1200)
    expect(history().pendingUntil).toBeNull()
    expect(history().entries).toEqual([home, session1, session2])
    expect(history().index).toBe(1)
  })

  it('puts the place it landed in the slot of a target that never arrives', () => {
    history().record(home, 0)
    history().record(session1, 0)
    history().go(-1, 0)

    history().record(projectA, NAVIGATION_ARRIVAL_TIMEOUT_MS)
    expect(history().pendingUntil).toBeNull()
    // Forward still reaches session 1.
    expect(history().entries).toEqual([projectA, session1])
    expect(history().index).toBe(0)
  })

  it('does not get stuck on a target that can no longer be opened', () => {
    const projectB: NavigationLocation = { kind: 'project', projectId: 'b' }
    // session2 belongs to a workspace that has since been closed.
    history().record(home, 0)
    history().record(session1, 0)
    history().record(session2, 0)
    history().record(projectB, 0)

    // Back to session2: it cannot open, so the app settles on project A.
    history().go(-1, 1000)
    history().record(projectA, 1000 + NAVIGATION_ARRIVAL_TIMEOUT_MS)
    expect(history().entries).toEqual([home, session1, projectA, projectB])

    // The next Back reaches the entry before the dead one; Forward keeps B.
    expect(history().go(-1, 5000)).toEqual(session1)
    history().record(session1, 5100)
    expect(history().go(1, 6000)).toEqual(projectA)
    history().record(projectA, 6100)
    expect(history().go(1, 7000)).toEqual(projectB)
  })

  it('merges the landing place into a neighbour that shows the same place', () => {
    history().record(home, 0)
    history().record(projectA, 0)
    history().record(session1, 0)
    history().record(session2, 0)

    // Back to session1 fails and lands on project A, the entry before it.
    history().go(-1, 1000)
    history().record(projectA, 1000 + NAVIGATION_ARRIVAL_TIMEOUT_MS)
    expect(history().entries).toEqual([home, projectA, session2])
    expect(history().index).toBe(1)
  })

  it('keeps at most 100 entries', () => {
    for (let i = 0; i < 120; i++) {
      history().record({ kind: 'project', projectId: `p${i}` }, 0)
    }
    expect(history().entries).toHaveLength(100)
    expect(history().entries[0]).toEqual({ kind: 'project', projectId: 'p20' })
    expect(history().index).toBe(99)
  })
})
