import { create } from 'zustand'

/** A place the user can go back to with the title bar Back button. */
export type NavigationLocation =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string }
  /** A session in the project canvas's session modal. */
  | {
      kind: 'session'
      projectId: string
      worktreeId: string
      sessionId: string
    }
  /** A session in the full-window inline ChatWindow. */
  | {
      kind: 'chat'
      projectId: string | null
      worktreeId: string
      worktreePath: string
      sessionId: string | null
    }

const MAX_ENTRIES = 100

/** How long Back/Forward waits for the app to arrive at the target entry. */
export const NAVIGATION_ARRIVAL_TIMEOUT_MS = 2000

/** Two locations that show the user the same thing. */
export function isSameLocation(
  a: NavigationLocation,
  b: NavigationLocation
): boolean {
  switch (a.kind) {
    case 'home':
      return b.kind === 'home'
    case 'project':
      return b.kind === 'project' && b.projectId === a.projectId
    case 'session':
      return (
        b.kind === 'session' &&
        b.worktreeId === a.worktreeId &&
        b.sessionId === a.sessionId
      )
    case 'chat':
      return (
        b.kind === 'chat' &&
        b.worktreeId === a.worktreeId &&
        b.sessionId === a.sessionId
      )
  }
}

interface NavigationHistoryState {
  entries: NavigationLocation[]
  /** Index of the current entry; -1 while the history is empty. */
  index: number
  /** Set by `go`: until this time, locations that do not match the target
   *  entry are intermediate states of the replay and are not recorded. */
  pendingUntil: number | null
  /** Add a settled location. A new location drops the forward entries. */
  record: (location: NavigationLocation, now: number) => void
  /** Move the cursor by `delta` and return the entry to navigate to. */
  go: (delta: -1 | 1, now: number) => NavigationLocation | null
}

export const useNavigationHistoryStore = create<NavigationHistoryState>(
  (set, get) => ({
    entries: [],
    index: -1,
    pendingUntil: null,

    record: (location, now) => {
      const { entries, index, pendingUntil } = get()
      const current = entries[index]

      if (pendingUntil !== null) {
        if (current && isSameLocation(location, current)) {
          set({ pendingUntil: null })
          return
        }
        if (now < pendingUntil) return
        set({ pendingUntil: null })
      }

      if (current && isSameLocation(location, current)) return

      const next = [...entries.slice(0, index + 1), location].slice(
        -MAX_ENTRIES
      )
      set({ entries: next, index: next.length - 1 })
    },

    go: (delta, now) => {
      const { entries, index } = get()
      const target = entries[index + delta]
      if (!target) return null
      set({
        index: index + delta,
        pendingUntil: now + NAVIGATION_ARRIVAL_TIMEOUT_MS,
      })
      return target
    },
  })
)
