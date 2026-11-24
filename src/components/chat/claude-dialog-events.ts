import { useCallback } from 'react'
import { invoke } from '@/lib/transport'
import { useChatStore, type ParkedClaudeDialog } from '@/store/chat-store'
import type { Backend, ToolCall } from '@/types/chat'
import { hasQuestionAnswerOutput, isAskUserQuestion } from '@/types/chat'

/** Payload of `claude:dialog-waiting` (see jean-core/src/chat/claude_dialog.rs). */
export interface ClaudeDialogWaitingEvent {
  sessionId: string
  toolUseId: string
  kind: string
}

/** Payload of `claude:dialog-resolved`. */
export interface ClaudeDialogResolvedEvent {
  sessionId: string
  toolUseId: string
}

/**
 * A live Claude run parked on a question or plan (#136). The run waits for
 * the answer as the tool result of the same call, so the session waits for
 * input while it still runs. Returns true when the dialog is new, so the
 * caller plays the waiting sound and notifies only once.
 */
export function applyClaudeDialogWaiting(
  payload: ClaudeDialogWaitingEvent
): boolean {
  const { sessionId, toolUseId } = payload
  const kind: ParkedClaudeDialog['kind'] =
    payload.kind === 'plan' ? 'plan' : 'question'
  const store = useChatStore.getState()
  const current = store.parkedClaudeDialogs[sessionId]
  const isNew = current?.toolUseId !== toolUseId
  store.setParkedClaudeDialog(sessionId, { toolUseId, kind })
  store.setWaitingForInput(sessionId, true)
  return isNew
}

/** The parked dialog was answered, declined, cancelled or timed out. */
export function applyClaudeDialogResolved(
  payload: ClaudeDialogResolvedEvent
): void {
  const { sessionId, toolUseId } = payload
  const store = useChatStore.getState()
  if (store.parkedClaudeDialogs[sessionId]?.toolUseId !== toolUseId) return
  store.setParkedClaudeDialog(sessionId, null)
  store.setWaitingForInput(sessionId, false)
}

/**
 * Match the parked dialogs with the host's list. A client that missed
 * `claude:dialog-waiting` (reload, reconnect, a remote window or web access
 * opened later) otherwise shows the waiting run as still running, and one
 * that missed `claude:dialog-resolved` keeps it waiting. The host's list is
 * the truth; a failed call leaves the client as it is.
 */
export async function refreshParkedClaudeDialogs(
  listParked: () => Promise<ClaudeDialogWaitingEvent[]> = () =>
    invoke<ClaudeDialogWaitingEvent[]>('list_parked_claude_dialogs')
): Promise<void> {
  let dialogs: ClaudeDialogWaitingEvent[]
  try {
    dialogs = await listParked()
  } catch (err) {
    console.warn('[claude-dialog] Failed to list parked dialogs:', err)
    return
  }
  if (!Array.isArray(dialogs)) return
  const live = new Set(dialogs.map(dialog => dialog.toolUseId))
  const parked = useChatStore.getState().parkedClaudeDialogs
  for (const [sessionId, dialog] of Object.entries(parked)) {
    if (!live.has(dialog.toolUseId)) {
      applyClaudeDialogResolved({ sessionId, toolUseId: dialog.toolUseId })
    }
  }
  for (const dialog of dialogs) applyClaudeDialogWaiting(dialog)
}

/** The Claude dialog a session's live run is parked on, if any. */
export function getParkedClaudeDialog(
  sessionId: string
): ParkedClaudeDialog | undefined {
  return useChatStore.getState().parkedClaudeDialogs[sessionId]
}

/**
 * A Claude `ExitPlanMode` with a tool result was approved or declined in its
 * own turn (#136), so its plan no longer waits for approval. A plan cut off by
 * the legacy kill has no result and still waits. Claude only: other backends
 * map their own plan tools to `ExitPlanMode` and keep their rules.
 */
export function isPlanAnsweredInTurn(
  toolCall: ToolCall,
  backend: Backend | null | undefined
): boolean {
  return (
    backend === 'claude' &&
    toolCall.name === 'ExitPlanMode' &&
    !!toolCall.output?.trim()
  )
}

/**
 * A new message instead of an answer skips the dialog a live Claude run is
 * parked on (#141, #136). The question card shows "Skipped"; the backend
 * declines the parked call and tells the model to end its turn, so the new
 * message (queued meanwhile) starts the next one. Returns true when a dialog
 * was parked.
 */
export function skipParkedClaudeDialog(
  sessionId: string,
  invokeSkip: (sessionId: string) => Promise<unknown>
): boolean {
  const parked = getParkedClaudeDialog(sessionId)
  if (!parked) return false
  const store = useChatStore.getState()
  if (parked.kind === 'question') {
    store.markQuestionAnswered(sessionId, parked.toolUseId, [])
  }
  invokeSkip(sessionId).catch(err => {
    console.error('[claude-dialog] Failed to skip the parked dialog:', err)
  })
  return true
}

/**
 * Restore the parked dialog after a reload or in another client, which missed
 * the `claude:dialog-waiting` event: the first open question or plan of the
 * live turn is checked with the backend. Returns the dialog it found.
 */
export async function hydrateParkedClaudeDialog(
  sessionId: string,
  toolCalls: readonly ToolCall[],
  isPending: (toolUseId: string) => Promise<boolean>
): Promise<ParkedClaudeDialog | undefined> {
  if (getParkedClaudeDialog(sessionId)) return undefined
  const open = toolCalls.find(
    tc =>
      (tc.name === 'AskUserQuestion' || tc.name === 'ExitPlanMode') &&
      !tc.output
  )
  if (!open || !(await isPending(open.id))) return undefined
  const dialog: ParkedClaudeDialog = {
    toolUseId: open.id,
    kind: open.name === 'ExitPlanMode' ? 'plan' : 'question',
  }
  applyClaudeDialogWaiting({ sessionId, ...dialog })
  return dialog
}

/** The note on a question or plan whose run has ended (#155). */
export const PAUSED_QUESTION_NOTE =
  'The agent is paused — answering resumes it.'
export const PAUSED_PLAN_NOTE = 'The agent is paused — approving resumes it.'

/**
 * A question or plan in a finished message waits with no run behind it: no
 * turn is sending and no live run is parked on this call (#155). Claude pauses
 * such a run after 10 minutes, or it ended another way (app quit, crash). The
 * answer resumes the session as a new message.
 */
export function isDialogPaused(state: {
  sending: boolean
  parkedToolUseId: string | null
  toolUseId: string
}): boolean {
  return !state.sending && state.parkedToolUseId !== state.toolUseId
}

/** {@link isDialogPaused} for one session, subscribed to the store data. */
export function useIsDialogPaused(
  sessionId: string | null | undefined
): (toolUseId: string) => boolean {
  const sending = useChatStore(state =>
    sessionId ? !!state.sendingSessionIds[sessionId] : false
  )
  const parkedToolUseId = useChatStore(state =>
    sessionId ? (state.parkedClaudeDialogs[sessionId]?.toolUseId ?? null) : null
  )
  return useCallback(
    (toolUseId: string) =>
      isDialogPaused({ sending, parkedToolUseId, toolUseId }),
    [sending, parkedToolUseId]
  )
}

/**
 * The live run waits for the user: a Claude dialog is parked on it (#136),
 * or a streamed question (OpenCode, Codex) has no answer yet. Nothing runs
 * then, so the chat shows no running timer or spinner.
 */
export function isRunAwaitingAnswer(state: {
  parked: boolean
  toolCalls: readonly ToolCall[]
  isAnswered: (toolCallId: string) => boolean
}): boolean {
  if (state.parked) return true
  return state.toolCalls.some(
    tc =>
      isAskUserQuestion(tc) &&
      !hasQuestionAnswerOutput(tc.output) &&
      !state.isAnswered(tc.id)
  )
}
