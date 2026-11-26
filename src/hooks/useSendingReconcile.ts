import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { invoke, listen, useWsConnectionStatus } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { reconcileSendingState } from '@/lib/sending-reconcile'
import { useChatStore } from '@/store/chat-store'
import { chatQueryKeys } from '@/services/chat'
import type { Session, WorktreeSessions } from '@/types/chat'

/** Slow check, only while some session is marked as sending. */
const RECONCILE_INTERVAL_MS = 30_000

function lastRunStartedAtMs(
  queryClient: QueryClient,
  sessionId: string
): number | undefined {
  const session = queryClient.getQueryData<Session>(
    chatQueryKeys.session(sessionId)
  )
  if (session?.last_run_started_at) return session.last_run_started_at * 1000
  for (const [, data] of queryClient.getQueriesData<WorktreeSessions>({
    queryKey: [...chatQueryKeys.all, 'sessions'],
  })) {
    const found = data?.sessions?.find(s => s.id === sessionId)
    if (found?.last_run_started_at) return found.last_run_started_at * 1000
  }
  return undefined
}

function invalidateSession(queryClient: QueryClient, sessionId: string) {
  queryClient.invalidateQueries({ queryKey: chatQueryKeys.session(sessionId) })
  const worktreeId = useChatStore.getState().sessionWorktreeMap[sessionId]
  if (worktreeId) {
    queryClient.invalidateQueries({
      queryKey: chatQueryKeys.sessions(worktreeId),
    })
  }
  queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
}

/**
 * Keep `sendingSessionIds` in line with the host (#163). Runs when the
 * window gets focus or becomes visible, after a WebSocket reconnect, and
 * every 30 s while a session is marked as sending. Mount once (App).
 */
export function useSendingReconcile(): void {
  const queryClient = useQueryClient()
  const wsConnected = useWsConnectionStatus()
  const finishedAtRef = useRef<Record<string, number>>({})
  const inFlightRef = useRef(false)
  // A session that runs a CLI in a terminal tab is marked as sending by
  // `terminal:working`, with no send on the host. The host's list never holds
  // it, so the reconcile must leave its mark alone.
  const terminalSessionIdsRef = useRef(new Set<string>())
  const reconcileRef = useRef<() => Promise<void>>(async () => undefined)

  const anySending = useChatStore(
    state => Object.keys(state.sendingSessionIds).length > 0
  )

  // Note when a session stops sending, so a reconcile that raced the
  // closing event does not set the mark again.
  useEffect(
    () =>
      useChatStore.subscribe((state, prev) => {
        if (state.sendingSessionIds === prev.sendingSessionIds) return
        for (const id of Object.keys(prev.sendingSessionIds)) {
          if (!state.sendingSessionIds[id]) {
            finishedAtRef.current[id] = Date.now()
          }
        }
      }),
    []
  )

  reconcileRef.current = async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const sendingBefore = useChatStore.getState().sendingSessionIds
      let hostIds: unknown
      try {
        hostIds = await invoke<string[]>('list_sending_sessions')
      } catch (error) {
        logger.debug('list_sending_sessions failed', { error })
        return
      }
      if (!Array.isArray(hostIds)) return

      const store = useChatStore.getState()
      const { clear, add } = reconcileSendingState({
        hostIds,
        sendingBefore,
        sendingNow: store.sendingSessionIds,
        sendStartedAt: store.sendStartedAt,
        finishedAt: finishedAtRef.current,
        now: Date.now(),
      })

      for (const sessionId of clear) {
        if (terminalSessionIdsRef.current.has(sessionId)) continue
        logger.warn(
          'Reconcile: host has no run for a session marked as sending, clearing it',
          { sessionId, direction: 'clear' }
        )
        // Leave the session as chat:done does, but keep a pending question
        // (that is saved state, not part of the run) and drop the duration:
        // the real end of the run is not known here.
        const wasWaiting = !!store.waitingForInputSessionIds[sessionId]
        store.completeSession(sessionId)
        useChatStore.setState(state => {
          const hasDuration = sessionId in state.completedDurations
          const needsWaiting =
            wasWaiting && !state.waitingForInputSessionIds[sessionId]
          if (!hasDuration && !needsWaiting) return state
          const { [sessionId]: _d, ...completedDurations } =
            state.completedDurations
          return {
            completedDurations,
            ...(needsWaiting && {
              waitingForInputSessionIds: {
                ...state.waitingForInputSessionIds,
                [sessionId]: true,
              },
            }),
          }
        })
        invalidateSession(queryClient, sessionId)
      }

      for (const sessionId of add) {
        logger.warn(
          'Reconcile: host runs a session not marked as sending, setting it',
          { sessionId, direction: 'add' }
        )
        useChatStore
          .getState()
          .addSendingSession(
            sessionId,
            lastRunStartedAtMs(queryClient, sessionId)
          )
        invalidateSession(queryClient, sessionId)
      }
    } finally {
      inFlightRef.current = false
    }
  }

  useEffect(() => {
    const unlisten = listen<{ sessionId?: string }>(
      'terminal:working',
      event => {
        const sessionId = event.payload?.sessionId
        if (sessionId) terminalSessionIdsRef.current.add(sessionId)
      }
    )
    return () => {
      unlisten.then(off => off()).catch(() => undefined)
    }
  }, [])

  // Focus and visibility.
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === 'visible') void reconcileRef.current()
    }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [])

  // When the WebSocket (re)connects (web access): events sent while it was
  // down may be lost.
  const wasConnectedRef = useRef(wsConnected)
  useEffect(() => {
    if (wsConnected && !wasConnectedRef.current) void reconcileRef.current()
    wasConnectedRef.current = wsConnected
  }, [wsConnected])

  // Slow interval while a session is marked as sending.
  useEffect(() => {
    if (!anySending) return
    const timer = setInterval(
      () => void reconcileRef.current(),
      RECONCILE_INTERVAL_MS
    )
    return () => clearInterval(timer)
  }, [anySending])
}
