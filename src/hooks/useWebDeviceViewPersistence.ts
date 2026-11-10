import { useEffect } from 'react'
import { isNativeApp } from '@/lib/environment'
import { saveWebDeviceView, type WebDeviceView } from '@/lib/web-device-view'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

const SAVE_DELAY_MS = 300

/** This browser's view, read from the stores. */
export function currentWebDeviceView(): WebDeviceView {
  const { selectedProjectId } = useProjectsStore.getState()
  const {
    activeWorktreeId,
    activeWorktreePath,
    activeSessionIds,
    worktreePaths,
  } = useChatStore.getState()
  const {
    sessionChatModalOpen,
    sessionChatModalWorktreeId,
    mobileActiveTab,
    zenMode,
  } = useUIStore.getState()
  const modalWorktreeId = sessionChatModalOpen
    ? sessionChatModalWorktreeId
    : null
  return {
    projectId: selectedProjectId,
    activeWorktreeId: activeWorktreePath ? activeWorktreeId : null,
    activeWorktreePath: activeWorktreeId ? activeWorktreePath : null,
    modalWorktreeId,
    modalWorktreePath: modalWorktreeId
      ? (worktreePaths[modalWorktreeId] ?? null)
      : null,
    activeSessionId: modalWorktreeId
      ? (activeSessionIds[modalWorktreeId] ?? null)
      : null,
    mobileTab: mobileActiveTab,
    zenMode,
  }
}

/**
 * Web Access: keep this browser's view in `localStorage` (#72). Saves after
 * each view change, and at once when the page goes to the background, because
 * iOS can end it there without another event.
 *
 * Starts only after the UI state was restored, else the default stores of the
 * first render would overwrite the saved view.
 */
export function useWebDeviceViewPersistence(): void {
  const initialized = useUIStore(state => state.uiStateInitialized)

  useEffect(() => {
    if (isNativeApp() || !initialized) return

    let lastSaved = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const saveNow = () => {
      if (timer) clearTimeout(timer)
      timer = null
      const view = currentWebDeviceView()
      const serialized = JSON.stringify(view)
      if (serialized === lastSaved) return
      lastSaved = serialized
      saveWebDeviceView(view)
    }
    // Not a debounce: the chat store changes on every streamed chunk, and a
    // timer that restarts on each change would never fire during a run.
    const scheduleSave = () => {
      if (timer) return
      timer = setTimeout(saveNow, SAVE_DELAY_MS)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveNow()
    }

    saveNow()
    const unsubscribers = [
      useProjectsStore.subscribe(scheduleSave),
      useChatStore.subscribe(scheduleSave),
      useUIStore.subscribe(scheduleSave),
    ]
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', saveNow)
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe())
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', saveNow)
      if (timer) clearTimeout(timer)
    }
  }, [initialized])
}
