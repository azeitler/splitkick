import { navigateToProject, navigateToSession } from '@/lib/navigate-to-session'
import { useChatStore } from '@/store/chat-store'
import {
  useNavigationHistoryStore,
  type NavigationLocation,
} from '@/store/navigation-history-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/**
 * One navigation passes through several store states (a project switch clears
 * the modal, the canvas remounts, the modal opens one render later). Only the
 * state that holds still this long becomes a history entry.
 */
const SETTLE_MS = 300

let settleTimer: ReturnType<typeof setTimeout> | undefined

/** Where the user is now, or null when it cannot be replayed. */
export function readCurrentLocation(): NavigationLocation | null {
  const { selectedProjectId } = useProjectsStore.getState()
  const { activeWorktreeId, activeWorktreePath, activeSessionIds } =
    useChatStore.getState()
  const { sessionChatModalOpen, sessionChatModalWorktreeId } =
    useUIStore.getState()

  // Same precedence as MainWindowContent: the inline chat covers everything.
  if (activeWorktreeId && activeWorktreePath) {
    return {
      kind: 'chat',
      projectId: selectedProjectId,
      worktreeId: activeWorktreeId,
      worktreePath: activeWorktreePath,
      sessionId: activeSessionIds[activeWorktreeId] ?? null,
    }
  }
  if (!selectedProjectId) return { kind: 'home' }
  if (sessionChatModalOpen && sessionChatModalWorktreeId) {
    const sessionId = activeSessionIds[sessionChatModalWorktreeId]
    if (!sessionId) return null
    return {
      kind: 'session',
      projectId: selectedProjectId,
      worktreeId: sessionChatModalWorktreeId,
      sessionId,
    }
  }
  return { kind: 'project', projectId: selectedProjectId }
}

export function navigateToLocation(location: NavigationLocation): void {
  switch (location.kind) {
    case 'home':
      useProjectsStore.getState().selectProject(null)
      useChatStore.getState().clearActiveWorktree()
      return
    case 'project':
      navigateToProject(location.projectId)
      // Show the canvas itself: close an open session, skip "restore last session".
      useUIStore.getState().requestProjectHome(location.projectId)
      return
    case 'session':
      navigateToSession(location)
      return
    case 'chat': {
      const projects = useProjectsStore.getState()
      if (projects.selectedProjectId !== location.projectId) {
        projects.selectProject(location.projectId)
      }
      projects.selectWorktree(location.worktreeId)
      const chat = useChatStore.getState()
      if (location.sessionId) {
        chat.setActiveSession(location.worktreeId, location.sessionId)
      }
      chat.setActiveWorktree(location.worktreeId, location.worktreePath)
      return
    }
  }
}

function settle(): void {
  const location = readCurrentLocation()
  if (!location) return
  useNavigationHistoryStore.getState().record(location, Date.now())

  // Still on the way to a Back/Forward target: look again when the wait ends,
  // so a navigation made during the wait is not lost.
  const { pendingUntil } = useNavigationHistoryStore.getState()
  if (pendingUntil !== null) {
    scheduleSettle(Math.max(pendingUntil - Date.now(), 0) + SETTLE_MS)
  }
}

function scheduleSettle(delay = SETTLE_MS): void {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(settle, delay)
}

function travel(delta: -1 | 1): void {
  const target = useNavigationHistoryStore.getState().go(delta, Date.now())
  if (!target) return
  navigateToLocation(target)
  scheduleSettle()
}

export function goBack(): void {
  travel(-1)
}

export function goForward(): void {
  travel(1)
}

/** Record every settled location change. Returns the uninstall function. */
export function installNavigationHistoryRecorder(): () => void {
  const unsubscribers = [
    useProjectsStore.subscribe((state, prev) => {
      if (state.selectedProjectId !== prev.selectedProjectId) scheduleSettle()
    }),
    useChatStore.subscribe((state, prev) => {
      if (
        state.activeWorktreeId !== prev.activeWorktreeId ||
        state.activeWorktreePath !== prev.activeWorktreePath ||
        state.activeSessionIds !== prev.activeSessionIds
      ) {
        scheduleSettle()
      }
    }),
    useUIStore.subscribe((state, prev) => {
      // Launch restore moves the app to the last view. What was recorded
      // before is not a place the user visited, so start the history over.
      if (state.uiStateInitialized && !prev.uiStateInitialized) {
        useNavigationHistoryStore.setState({
          entries: [],
          index: -1,
          pendingUntil: null,
        })
        scheduleSettle()
      } else if (
        state.sessionChatModalOpen !== prev.sessionChatModalOpen ||
        state.sessionChatModalWorktreeId !== prev.sessionChatModalWorktreeId
      ) {
        scheduleSettle()
      }
    }),
  ]
  // The start location: whatever the app restored on launch.
  scheduleSettle()

  return () => {
    clearTimeout(settleTimer)
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
