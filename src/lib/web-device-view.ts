/**
 * The view of one Web Access browser (#72, gap 2 in mobile-gap-analysis.md).
 *
 * The host keeps one UI-state blob for every client. Its view fields (open
 * project, worktree, phone tab, zen mode) are the view of whichever client
 * saved last, often the desktop. iOS ends the Home Screen app in the
 * background, so a phone reloads often, and then it opened on the desktop's
 * view.
 *
 * So every Web Access browser keeps its own view in `localStorage` (it
 * survives the process end; `sessionStorage` does not), prefers it over the
 * host's view on start, and writes the host's view back into the blob, not
 * its own (`ui-state-snapshot.ts`). The native app keeps the shared blob.
 */
import { isNativeApp } from '@/lib/environment'
import { getActiveConnectionId } from '@/lib/remote-connections'
import { isMobileTab, type MobileTab, type UIState } from '@/types/ui-state'

const STORAGE_KEY_PREFIX = 'jean:web-device-view:'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface WebDeviceView {
  projectId: string | null
  /** The full-screen ChatWindow route (desktop browsers; never on a phone). */
  activeWorktreeId: string | null
  activeWorktreePath: string | null
  /** The session modal on the project canvas, with its session. */
  modalWorktreeId: string | null
  modalWorktreePath: string | null
  activeSessionId: string | null
  mobileTab: MobileTab | null
  zenMode: boolean
}

export interface WebDeviceModal {
  modalWorktreeId: string
  modalWorktreePath: string
  activeSessionId: string
}

/** Web Access swaps its server in place, so each connection has its own view. */
function storageKey(): string {
  return `${STORAGE_KEY_PREFIX}${getActiveConnectionId()}`
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function saveWebDeviceView(view: WebDeviceView, now = Date.now()): void {
  if (isNativeApp()) return
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({ ...view, savedAt: now })
    )
  } catch {
    // Best-effort: full or blocked storage must never break the app.
  }
}

/** This browser's saved view, or null (native app, none saved, too old). */
export function peekWebDeviceView(now = Date.now()): WebDeviceView | null {
  if (isNativeApp()) return null
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return null
    const stored = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof stored.savedAt !== 'number' ||
      now - stored.savedAt > MAX_AGE_MS
    ) {
      return null
    }
    const activeWorktreeId = optionalString(stored.activeWorktreeId)
    const activeWorktreePath = optionalString(stored.activeWorktreePath)
    return {
      projectId: optionalString(stored.projectId),
      activeWorktreeId: activeWorktreePath ? activeWorktreeId : null,
      activeWorktreePath: activeWorktreeId ? activeWorktreePath : null,
      modalWorktreeId: optionalString(stored.modalWorktreeId),
      modalWorktreePath: optionalString(stored.modalWorktreePath),
      activeSessionId: optionalString(stored.activeSessionId),
      mobileTab: isMobileTab(stored.mobileTab) ? stored.mobileTab : null,
      zenMode: stored.zenMode === true,
    }
  } catch {
    return null
  }
}

/**
 * The project to open first: this browser's, else the host's. A saved view
 * with no project means the browser was on Home, so it opens Home.
 */
export function webDeviceProjectId(
  hostProjectId: string | null | undefined
): string | null {
  const view = peekWebDeviceView()
  return view ? view.projectId : (hostProjectId ?? null)
}

/**
 * The host's UI state with this browser's view in place of the host's view
 * fields. Without a saved view (first start) the host's project stays. A
 * phone never opens the full-screen ChatWindow route (gap 1), so its active
 * worktree is always cleared.
 */
export function withWebDeviceView(
  uiState: UIState,
  view: WebDeviceView | null,
  mobile: boolean
): UIState {
  const activeWorktree = mobile
    ? { id: null, path: null }
    : view
      ? { id: view.activeWorktreeId, path: view.activeWorktreePath }
      : { id: uiState.active_worktree_id, path: uiState.active_worktree_path }
  if (!view) {
    return {
      ...uiState,
      active_worktree_id: activeWorktree.id,
      active_worktree_path: activeWorktree.path,
    }
  }
  return {
    ...uiState,
    active_project_id: view.projectId,
    active_worktree_id: activeWorktree.id,
    active_worktree_path: activeWorktree.path,
    mobile_active_tab: view.mobileTab ?? uiState.mobile_active_tab,
    zen_mode: view.zenMode,
  }
}

let modalRestored = false

/**
 * The session modal to open again, once per page load and only for its
 * project. The view itself stays saved: the next reload needs it again.
 */
export function consumeWebDeviceModal(
  projectId: string
): WebDeviceModal | null {
  if (modalRestored) return null
  const view = peekWebDeviceView()
  if (
    !view ||
    view.projectId !== projectId ||
    !view.modalWorktreeId ||
    !view.modalWorktreePath ||
    !view.activeSessionId
  ) {
    return null
  }
  modalRestored = true
  return {
    modalWorktreeId: view.modalWorktreeId,
    modalWorktreePath: view.modalWorktreePath,
    activeSessionId: view.activeSessionId,
  }
}

/** Tests only. */
export function resetWebDeviceModalForTests(): void {
  modalRestored = false
}
