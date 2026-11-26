/**
 * The host is the source of truth for "this session runs" (#163).
 *
 * A client marks a session as sending on `chat:sending` and clears the mark
 * on `chat:done` / `chat:cancelled` / `chat:error`. A client that misses the
 * closing event would show the session as running forever (timer counting,
 * new messages queued). The reconcile compares the client's marks with the
 * host's `list_sending_sessions` and corrects the difference.
 */

/** A change this young may not have reached the host (or the client) yet. */
export const SENDING_RECONCILE_GRACE_MS = 15_000

export interface SendingReconcileInput {
  /** Sessions the host has a send in flight for. */
  hostIds: readonly string[]
  /** The client's marks before the host was asked. */
  sendingBefore: Record<string, boolean>
  /** The client's marks now (after the answer arrived). */
  sendingNow: Record<string, boolean>
  /** When this client started each send (ms). */
  sendStartedAt: Record<string, number>
  /** When this client last saw each session stop sending (ms). */
  finishedAt: Record<string, number>
  now: number
}

export interface SendingReconcileResult {
  /** Marked as sending here, not running on the host: clear. */
  clear: string[]
  /** Running on the host, not marked here: set. */
  add: string[]
}

/**
 * Only correct a mark that was the same before and after the request, so an
 * event that arrived while the request was in flight wins. Skip a send that
 * started, or a run that ended, inside the grace window.
 */
export function reconcileSendingState({
  hostIds,
  sendingBefore,
  sendingNow,
  sendStartedAt,
  finishedAt,
  now,
}: SendingReconcileInput): SendingReconcileResult {
  const host = new Set(hostIds)
  const clear = Object.keys(sendingNow).filter(
    id =>
      sendingNow[id] &&
      sendingBefore[id] &&
      !host.has(id) &&
      now - (sendStartedAt[id] ?? 0) >= SENDING_RECONCILE_GRACE_MS
  )
  const add = [...host].filter(
    id =>
      !sendingNow[id] &&
      !sendingBefore[id] &&
      now - (finishedAt[id] ?? 0) >= SENDING_RECONCILE_GRACE_MS
  )
  return { clear, add }
}
