/**
 * The prompt outbox: the safety net that keeps a submitted prompt until the
 * backend holds it.
 *
 * Every send and every enqueue writes its prompt here first (`track`), before
 * the input is cleared. The entry is saved in localStorage, so it survives a
 * reload and an app quit. It leaves the outbox only when the backend confirms
 * the prompt (`confirm`, `confirmSent`) or the user discards it.
 *
 * A call that ends without a confirmation (an error, a timeout, a dropped
 * socket, a reload) leaves the entry `pending` and not in flight. Then
 * `recoverOutbox` reads the session from the backend: a prompt in its messages
 * or its queue is confirmed (no duplicate); any other prompt becomes `unsent`
 * and goes back into the session's input, or shows as an "Unsent message" when
 * the user typed something new. See docs/developer/prompt-outbox.md.
 */
import { create } from 'zustand'
import { invoke } from '@/lib/transport'
import { isBackendOffline } from '@/lib/backend-online'
import { useChatStore } from '@/store/chat-store'
import type { QueuedMessage, Session } from '@/types/chat'

export const OUTBOX_STORAGE_KEY = 'jean:prompt-outbox:v1'

/**
 * A history message counts as this prompt only when it is not much older than
 * the submit. The slack covers a clock difference between a phone and the
 * host; an older message with the same text is an earlier prompt.
 */
const CLOCK_SLACK_SECONDS = 300

export type OutboxStatus =
  /** Not confirmed yet: in flight, or waiting for a check against the backend. */
  | 'pending'
  /** The backend does not hold it. Shown at the input until sent or discarded. */
  | 'unsent'
  /**
   * Put back into the input. Kept until the user sends, discards or edits it
   * while online: an input draft saves through the backend, which an offline
   * client cannot reach.
   */
  | 'restored'

export interface OutboxEntry {
  /** The queued message id when there is one, so the queue check can match it. */
  id: string
  sessionId: string
  worktreeId: string
  worktreePath: string
  /** What goes back into the input: the text the user typed. */
  text: string
  /** The message as the backend gets it (with file refs). */
  message: string
  /** Attachments and toolbar settings at submit time. */
  queued?: QueuedMessage
  /** Unix ms. */
  createdAt: number
  status: OutboxStatus
}

export type TrackInput = Omit<OutboxEntry, 'status' | 'createdAt' | 'text'> & {
  text?: string
}

interface OutboxState {
  entries: Record<string, OutboxEntry>
  /** Ids with a call in flight in this page. Not saved: a reload ends them. */
  inFlight: Record<string, true>
}

function loadEntries(): Record<string, OutboxEntry> {
  try {
    const raw = globalThis.localStorage?.getItem(OUTBOX_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, OutboxEntry>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveEntries(entries: Record<string, OutboxEntry>) {
  try {
    if (Object.keys(entries).length === 0) {
      globalThis.localStorage?.removeItem(OUTBOX_STORAGE_KEY)
    } else {
      globalThis.localStorage?.setItem(
        OUTBOX_STORAGE_KEY,
        JSON.stringify(entries)
      )
    }
  } catch (err) {
    console.error('[PromptOutbox] could not save the outbox', err)
  }
}

export const useOutboxStore = create<OutboxState>(() => ({
  entries: loadEntries(),
  inFlight: {},
}))

// Write-through: every change of the entries is saved at once (no debounce),
// so an app quit right after a submit keeps the prompt.
useOutboxStore.subscribe((state, prev) => {
  if (state.entries !== prev.entries) saveEntries(state.entries)
})

function setEntries(
  update: (entries: Record<string, OutboxEntry>) => Record<string, OutboxEntry>
) {
  useOutboxStore.setState(state => {
    const entries = update(state.entries)
    return entries === state.entries ? state : { entries }
  })
}

function setInFlight(id: string, on: boolean) {
  useOutboxStore.setState(state => {
    if (!!state.inFlight[id] === on) return state
    if (on) return { inFlight: { ...state.inFlight, [id]: true } }
    const { [id]: _, ...rest } = state.inFlight
    return { inFlight: rest }
  })
}

function removeEntry(id: string) {
  setInFlight(id, false)
  setEntries(entries => {
    if (!entries[id]) return entries
    const { [id]: _, ...rest } = entries
    return rest
  })
}

function setStatus(id: string, status: OutboxStatus) {
  setEntries(entries => {
    const entry = entries[id]
    if (!entry || entry.status === status) return entries
    return { ...entries, [id]: { ...entry, status } }
  })
}

/**
 * A call for this prompt starts. Adds the entry, or keeps the one that exists
 * (the submit wrote it with the typed text and attachments; a later send or
 * enqueue of the same prompt must not replace that).
 */
export function trackPrompt(input: TrackInput): void {
  setEntries(entries => {
    const existing = entries[input.id]
    if (existing) {
      return existing.status === 'pending'
        ? entries
        : { ...entries, [input.id]: { ...existing, status: 'pending' } }
    }
    const entry: OutboxEntry = {
      ...input,
      text: input.text ?? input.queued?.message ?? input.message,
      createdAt: Date.now(),
      status: 'pending',
    }
    return { ...entries, [input.id]: entry }
  })
  setInFlight(input.id, true)
}

/** Keep a prompt that no call carries any more (a failed queue edit). */
export function addUnsentPrompt(input: TrackInput): void {
  setEntries(entries => ({
    ...entries,
    [input.id]: {
      ...input,
      text: input.text ?? input.queued?.message ?? input.message,
      createdAt: Date.now(),
      status: 'unsent',
    },
  }))
}

/** The message as the backend gets it, once the send builds it. */
export function setPromptMessage(id: string, message: string): void {
  setEntries(entries => {
    const entry = entries[id]
    if (!entry || entry.message === message) return entries
    return { ...entries, [id]: { ...entry, message } }
  })
}

/** The backend holds the prompt (send accepted, enqueue or steer succeeded). */
export function confirmPrompt(id: string): void {
  removeEntry(id)
}

/** `chat:sending`: the backend started a turn with this message. */
export function confirmSentMessage(sessionId: string, message: string): void {
  const { entries } = useOutboxStore.getState()
  for (const entry of Object.values(entries)) {
    if (
      entry.sessionId === sessionId &&
      entry.status === 'pending' &&
      entry.message === message
    ) {
      removeEntry(entry.id)
    }
  }
}

/**
 * The call ended without a confirmation. Whether the backend holds the prompt
 * is open: `recoverOutbox` checks the session and decides.
 */
export function settlePrompt(id: string): void {
  setInFlight(id, false)
}

/** The backend refused the prompt for sure. */
export function markPromptUnsent(id: string): void {
  setInFlight(id, false)
  setStatus(id, 'unsent')
}

/** The user discarded the prompt, or sends it again from the input. */
export function discardPrompt(id: string): void {
  removeEntry(id)
}

/** A new submit in this session takes over what was put back into its input. */
export function dropRestoredPrompts(sessionId: string): void {
  setEntries(entries => {
    const kept = Object.values(entries).filter(
      e => !(e.sessionId === sessionId && e.status === 'restored')
    )
    if (kept.length === Object.keys(entries).length) return entries
    return Object.fromEntries(kept.map(e => [e.id, e]))
  })
}

/**
 * The input of a session changed. While the backend is reachable, the draft
 * saves through it, so a restored prompt that the user edited is safe there.
 */
export function noteInputDraftChanged(
  sessionId: string,
  draft: string,
  online: boolean
): void {
  if (!online) return
  const { entries } = useOutboxStore.getState()
  for (const entry of Object.values(entries)) {
    if (
      entry.sessionId === sessionId &&
      entry.status === 'restored' &&
      !draft.includes(entry.text.trim())
    ) {
      removeEntry(entry.id)
    }
  }
}

/** True when the session the backend returned holds this prompt. */
export function isHeldByBackend(entry: OutboxEntry, session: Session): boolean {
  if (
    session.queued_messages?.some(
      m => m.id === entry.id || m.message === entry.queued?.message
    )
  ) {
    return true
  }
  const since = entry.createdAt / 1000 - CLOCK_SLACK_SECONDS
  return (session.messages ?? []).some(
    m =>
      m.role === 'user' && m.content === entry.message && m.timestamp >= since
  )
}

/** Entries of one session that the input area shows (unsent ones). */
export function selectSessionUnsent(
  state: OutboxState,
  sessionId: string
): OutboxEntry[] {
  return Object.values(state.entries)
    .filter(e => e.sessionId === sessionId && e.status === 'unsent')
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Count of pending prompts of one session that wait for the connection. */
export function selectSessionWaiting(
  state: OutboxState,
  sessionId: string
): number {
  let count = 0
  for (const entry of Object.values(state.entries)) {
    if (entry.sessionId === sessionId && entry.status === 'pending') count++
  }
  return count
}

function mergeById<T extends { id: string }>(current: T[], added: T[]): T[] {
  const ids = new Set(current.map(item => item.id))
  const fresh = added.filter(item => !ids.has(item.id))
  return fresh.length === 0 ? current : [...current, ...fresh]
}

/** Put the prompt and its attachments into the session's (empty) input. */
export function restorePromptToInput(entry: OutboxEntry): void {
  useChatStore.getState().setInputDraft(entry.sessionId, entry.text)
  restoreAttachments(entry)
}

/**
 * "Edit" on an unsent message: into the input, below the text already there.
 * The `append-chat-input` event also updates the open textarea.
 */
export function editUnsentPrompt(entry: OutboxEntry): void {
  const draft = useChatStore.getState().inputDrafts[entry.sessionId] ?? ''
  if (!draft.trim()) {
    restorePromptToInput(entry)
  } else {
    window.dispatchEvent(
      new CustomEvent('append-chat-input', {
        detail: { text: `\n${entry.text}` },
      })
    )
    restoreAttachments(entry)
  }
  setStatus(entry.id, 'restored')
}

function restoreAttachments(entry: OutboxEntry): void {
  const q = entry.queued
  if (
    q &&
    (q.pendingImages.length > 0 ||
      q.pendingFiles.length > 0 ||
      q.pendingSkills.length > 0 ||
      q.pendingTextFiles.length > 0)
  ) {
    const sid = entry.sessionId
    useChatStore.setState(state => ({
      pendingImages: {
        ...state.pendingImages,
        [sid]: mergeById(state.pendingImages[sid] ?? [], q.pendingImages),
      },
      pendingFiles: {
        ...state.pendingFiles,
        [sid]: mergeById(state.pendingFiles[sid] ?? [], q.pendingFiles),
      },
      pendingSkills: {
        ...state.pendingSkills,
        [sid]: mergeById(state.pendingSkills[sid] ?? [], q.pendingSkills),
      },
      pendingTextFiles: {
        ...state.pendingTextFiles,
        [sid]: mergeById(state.pendingTextFiles[sid] ?? [], q.pendingTextFiles),
      },
    }))
  }
}

/**
 * Unsent and restored prompts: put each into its session's input when that
 * input is empty; when the input already holds it, it is restored. Otherwise
 * it stays `unsent`, and the input area shows it.
 */
export function restoreUnsentPrompts(): void {
  const { entries } = useOutboxStore.getState()
  const ordered = Object.values(entries)
    .filter(e => e.status === 'unsent' || e.status === 'restored')
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const entry of ordered) {
    const draft = (
      useChatStore.getState().inputDrafts[entry.sessionId] ?? ''
    ).trim()
    if (draft && draft.includes(entry.text.trim())) {
      setStatus(entry.id, 'restored')
    } else if (!draft) {
      restorePromptToInput(entry)
      setStatus(entry.id, 'restored')
    } else if (entry.status === 'restored') {
      // Restored before a reload, and the input now holds other text.
      setStatus(entry.id, 'unsent')
    }
  }
}

export type FetchSession = (entry: OutboxEntry) => Promise<Session>

const fetchSessionFromBackend: FetchSession = entry =>
  invoke<Session>('get_session', {
    sessionId: entry.sessionId,
    worktreeId: entry.worktreeId,
    worktreePath: entry.worktreePath,
    limit: 25,
  })

let recovering: Promise<void> | null = null
let recoverAgain = false

/**
 * Check every pending prompt without a call in flight against the backend,
 * then restore what it does not hold. Call it when the backend is reachable.
 * A check that fails (still offline) leaves the entry pending for next time.
 */
export function recoverOutbox(
  fetchSession: FetchSession = fetchSessionFromBackend
): Promise<void> {
  if (recovering) {
    recoverAgain = true
    return recovering
  }
  recovering = (async () => {
    do {
      recoverAgain = false
      const { entries, inFlight } = useOutboxStore.getState()
      const open = Object.values(entries).filter(
        e => e.status === 'pending' && !inFlight[e.id]
      )
      const bySession = new Map<string, OutboxEntry[]>()
      for (const entry of open) {
        bySession.set(entry.sessionId, [
          ...(bySession.get(entry.sessionId) ?? []),
          entry,
        ])
      }
      for (const group of bySession.values()) {
        let session: Session
        try {
          session = await fetchSession(group[0] as OutboxEntry)
        } catch (err) {
          console.warn('[PromptOutbox] session check failed', err)
          // Offline: check again when the connection is back. Online, the
          // read fails for good (session gone): show the prompt, do not hide it.
          if (isBackendOffline()) continue
          for (const entry of group) setStatus(entry.id, 'unsent')
          continue
        }
        for (const entry of group) {
          // A new call for it may have started while the read ran.
          const now = useOutboxStore.getState()
          if (now.inFlight[entry.id] || !now.entries[entry.id]) continue
          if (isHeldByBackend(entry, session)) confirmPrompt(entry.id)
          else setStatus(entry.id, 'unsent')
        }
      }
      restoreUnsentPrompts()
    } while (recoverAgain)
  })().finally(() => {
    recovering = null
  })
  return recovering
}
