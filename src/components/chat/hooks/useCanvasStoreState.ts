import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '@/store/chat-store'
import type { ChatStoreState } from '../session-card-utils'

/**
 * Streaming text changes every animation frame during a run. Reading it
 * lazily through a stable getter (instead of subscribing to the maps) keeps
 * every canvas/sidebar card consumer off the per-frame re-render path —
 * cards re-read the current text whenever a subscribed field changes.
 */
const getStreamingText: ChatStoreState['getStreamingText'] = sessionId => {
  const state = useChatStore.getState()
  return {
    content: state.streamingContents[sessionId] ?? '',
    blocks: state.streamingContentBlocks[sessionId] ?? [],
  }
}

/**
 * Subscribe to chat store state needed for computing session card data.
 * Uses individual selectors for reliable re-renders — useShallow's useRef
 * mutation inside selectors can race with React concurrent rendering,
 * causing stale state on the canvas when multi-field store updates fire.
 */
export function useCanvasStoreState(): ChatStoreState {
  const sendingSessionIds = useChatStore(state => state.sendingSessionIds)
  const executingModes = useChatStore(state => state.executingModes)
  const executionModes = useChatStore(state => state.executionModes)
  const activeToolCalls = useChatStore(state => state.activeToolCalls)
  const answeredQuestions = useChatStore(state => state.answeredQuestions)
  const waitingForInputSessionIds = useChatStore(
    state => state.waitingForInputSessionIds
  )
  const reviewingSessions = useChatStore(state => state.reviewingSessions)
  const sessionStatusOverrides = useChatStore(
    state => state.sessionStatusOverrides
  )
  const pendingPermissionDenials = useChatStore(
    state => state.pendingPermissionDenials
  )
  const pendingCodexPermissionRequests = useChatStore(
    state => state.pendingCodexPermissionRequests
  )
  const pendingOpencodePermissionRequests = useChatStore(
    state => state.pendingOpencodePermissionRequests
  )
  const pendingCodexCommandApprovalRequests = useChatStore(
    state => state.pendingCodexCommandApprovalRequests
  )
  const pendingCodexUserInputRequests = useChatStore(
    state => state.pendingCodexUserInputRequests
  )
  const pendingCodexMcpElicitationRequests = useChatStore(
    state => state.pendingCodexMcpElicitationRequests
  )
  const pendingCodexDynamicToolCallRequests = useChatStore(
    state => state.pendingCodexDynamicToolCallRequests
  )
  const sessionLabels = useChatStore(state => state.sessionLabels)

  return useMemo(
    () => ({
      sendingSessionIds,
      executingModes,
      executionModes,
      activeToolCalls,
      getStreamingText,
      answeredQuestions,
      waitingForInputSessionIds,
      reviewingSessions,
      sessionStatusOverrides,
      pendingPermissionDenials,
      pendingCodexPermissionRequests,
      pendingOpencodePermissionRequests,
      pendingCodexCommandApprovalRequests,
      pendingCodexUserInputRequests,
      pendingCodexMcpElicitationRequests,
      pendingCodexDynamicToolCallRequests,
      sessionLabels,
    }),
    [
      sendingSessionIds,
      executingModes,
      executionModes,
      activeToolCalls,
      answeredQuestions,
      waitingForInputSessionIds,
      reviewingSessions,
      sessionStatusOverrides,
      pendingPermissionDenials,
      pendingCodexPermissionRequests,
      pendingOpencodePermissionRequests,
      pendingCodexCommandApprovalRequests,
      pendingCodexUserInputRequests,
      pendingCodexMcpElicitationRequests,
      pendingCodexDynamicToolCallRequests,
      sessionLabels,
    ]
  )
}

/** Per-session maps of `ChatStoreState`, all keyed by session id. */
const PER_SESSION_FIELDS = [
  'sendingSessionIds',
  'executingModes',
  'executionModes',
  'activeToolCalls',
  'answeredQuestions',
  'waitingForInputSessionIds',
  'reviewingSessions',
  'sessionStatusOverrides',
  'pendingPermissionDenials',
  'pendingCodexPermissionRequests',
  'pendingOpencodePermissionRequests',
  'pendingCodexCommandApprovalRequests',
  'pendingCodexUserInputRequests',
  'pendingCodexMcpElicitationRequests',
  'pendingCodexDynamicToolCallRequests',
  'sessionLabels',
] as const satisfies readonly Exclude<
  keyof ChatStoreState,
  'getStreamingText'
>[]

/**
 * `useCanvasStoreState`, but only re-renders when state of the given sessions
 * changes. Each sidebar row renders a handful of sessions; subscribing it to
 * the whole maps re-rendered every row on every tool event of any session.
 *
 * The selector returns the per-session entries (cheap lookups, compared
 * shallowly), and the snapshot is read fresh when one of them changes.
 */
export function useSessionsCardStoreState(
  sessionIds: readonly string[]
): ChatStoreState {
  const entries = useChatStore(
    useShallow(state => {
      const values: unknown[] = []
      for (const id of sessionIds) {
        for (const field of PER_SESSION_FIELDS) values.push(state[field][id])
      }
      return values
    })
  )

  return useMemo(
    () => {
      const state = useChatStore.getState()
      return {
        ...Object.fromEntries(
          PER_SESSION_FIELDS.map(field => [field, state[field]])
        ),
        getStreamingText,
      } as ChatStoreState
    },
    // `entries` is the change signal; the snapshot itself is read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries]
  )
}
