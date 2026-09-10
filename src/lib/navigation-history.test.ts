import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import { useNavigationHistoryStore } from '@/store/navigation-history-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import {
  goBack,
  goForward,
  installNavigationHistoryRecorder,
  readCurrentLocation,
} from './navigation-history'

function showHome() {
  useProjectsStore.setState({ selectedProjectId: null })
  useChatStore.setState({ activeWorktreeId: null, activeWorktreePath: null })
  useUIStore.setState({
    sessionChatModalOpen: false,
    sessionChatModalWorktreeId: null,
  })
}

function showSessionModal(
  projectId: string,
  worktreeId: string,
  sessionId: string
) {
  useProjectsStore.setState({ selectedProjectId: projectId })
  useChatStore.setState(state => ({
    activeSessionIds: { ...state.activeSessionIds, [worktreeId]: sessionId },
  }))
  useUIStore.setState({
    sessionChatModalOpen: true,
    sessionChatModalWorktreeId: worktreeId,
  })
}

describe('readCurrentLocation', () => {
  beforeEach(() => {
    showHome()
    useChatStore.setState({ activeSessionIds: {} })
  })

  it('reads Home when no project is selected', () => {
    expect(readCurrentLocation()).toEqual({ kind: 'home' })
  })

  it('reads the project canvas when no session is open', () => {
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    expect(readCurrentLocation()).toEqual({ kind: 'project', projectId: 'p1' })
  })

  it('reads the session shown in the session modal', () => {
    showSessionModal('p1', 'w1', 's1')
    expect(readCurrentLocation()).toEqual({
      kind: 'session',
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's1',
    })
  })

  it('reads nothing while the modal has no session yet', () => {
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'w1',
    })
    expect(readCurrentLocation()).toBeNull()
  })

  it('gives the inline chat window precedence', () => {
    showSessionModal('p1', 'w1', 's1')
    useChatStore.setState({
      activeWorktreeId: 'w2',
      activeWorktreePath: '/repo/w2',
      activeSessionIds: { w2: 's9' },
    })
    expect(readCurrentLocation()).toEqual({
      kind: 'chat',
      projectId: 'p1',
      worktreeId: 'w2',
      worktreePath: '/repo/w2',
      sessionId: 's9',
    })
  })
})

describe('navigation history recorder', () => {
  let uninstall: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    showHome()
    useChatStore.setState({ activeSessionIds: {} })
    useUIStore.setState({ pendingProjectHomeId: null })
    useNavigationHistoryStore.setState({
      entries: [],
      index: -1,
      pendingUntil: null,
    })
    uninstall = installNavigationHistoryRecorder()
    vi.advanceTimersByTime(300)
  })

  afterEach(() => {
    uninstall()
    vi.useRealTimers()
  })

  const entries = () => useNavigationHistoryStore.getState().entries

  it('records the start location', () => {
    expect(entries()).toEqual([{ kind: 'home' }])
  })

  it('starts over when launch restore completes', () => {
    useUIStore.setState({ uiStateInitialized: false })
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    vi.advanceTimersByTime(300)
    expect(entries()).toHaveLength(2)

    showSessionModal('p1', 'w1', 's1')
    useUIStore.setState({ uiStateInitialized: true })
    vi.advanceTimersByTime(300)

    expect(entries()).toEqual([
      { kind: 'session', projectId: 'p1', worktreeId: 'w1', sessionId: 's1' },
    ])
  })

  it('records only the state that settles', () => {
    // One sidebar click: project first, the modal a moment later.
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    vi.advanceTimersByTime(50)
    showSessionModal('p1', 'w1', 's1')
    vi.advanceTimersByTime(300)

    expect(entries()).toEqual([
      { kind: 'home' },
      { kind: 'session', projectId: 'p1', worktreeId: 'w1', sessionId: 's1' },
    ])
  })

  it('goes back to the project canvas and forward again', () => {
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    vi.advanceTimersByTime(300)
    showSessionModal('p1', 'w1', 's1')
    vi.advanceTimersByTime(300)

    goBack()
    // The canvas closes its modal when it sees the project-home request.
    expect(useUIStore.getState().pendingProjectHomeId).toBe('p1')
    useUIStore.setState({
      sessionChatModalOpen: false,
      sessionChatModalWorktreeId: null,
    })
    vi.advanceTimersByTime(300)

    const history = useNavigationHistoryStore.getState()
    expect(history.index).toBe(1)
    expect(history.pendingUntil).toBeNull()
    expect(history.entries).toHaveLength(3)

    goForward()
    expect(useNavigationHistoryStore.getState().index).toBe(2)
    expect(useChatStore.getState().activeSessionIds.w1).toBe('s1')
    expect(useUIStore.getState().pendingAutoOpenSessionIds.w1).toBe('s1')
  })

  it('goes back to Home', () => {
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    vi.advanceTimersByTime(300)

    goBack()
    expect(useProjectsStore.getState().selectedProjectId).toBeNull()
    vi.advanceTimersByTime(300)
    expect(useNavigationHistoryStore.getState().index).toBe(0)
  })

  it('does not lose a navigation made while Back waits for its target', () => {
    showSessionModal('p1', 'w1', 's1')
    vi.advanceTimersByTime(300)
    showSessionModal('p1', 'w1', 's2')
    vi.advanceTimersByTime(300)

    goBack()
    // The target never arrives; the user opens another project instead.
    useUIStore.setState({ sessionChatModalOpen: false })
    useProjectsStore.setState({ selectedProjectId: 'p2' })
    vi.advanceTimersByTime(300)
    expect(entries()).toHaveLength(3)

    vi.advanceTimersByTime(2500)
    expect(entries().at(-1)).toEqual({ kind: 'project', projectId: 'p2' })
  })
})
