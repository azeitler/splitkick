import { useEffect, useRef } from 'react'
import { invoke } from '@/lib/transport'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { usePreferences } from '@/services/preferences'
import { useClaudeCliStatus } from '@/services/claude-cli'
import { chatQueryKeys } from '@/services/chat'
import { resolveBackend, supportsAdaptiveThinking } from '@/lib/model-utils'
import {
  DEFAULT_INVESTIGATE_ISSUE_PROMPT,
  DEFAULT_INVESTIGATE_PR_PROMPT,
  resolveMagicPromptProvider,
} from '@/types/preferences'
import type { WorktreeSessions, QueuedMessage } from '@/types/chat'
import { logger } from '@/lib/logger'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Headless hook for starting investigations on background-created worktrees.
 *
 * When a worktree is created via CMD+Click with auto-investigate, the ChatWindow
 * never mounts (no modal opens), so the auto-investigate flag is never consumed.
 * This hook watches those flags, builds the investigation prompt, and enqueues
 * it into messageQueues for useQueueProcessor to send — no modal needed.
 *
 * Must be mounted at App level alongside useQueueProcessor.
 */
export function useBackgroundInvestigation(): void {
  const { data: preferences } = usePreferences()
  const { data: cliStatus } = useClaudeCliStatus()
  const queryClient = useQueryClient()
  const processingRef = useRef<Set<string>>(new Set())

  // Subscribe to auto-investigate flags — re-run effect when they change
  const hasAutoInvestigate = useUIStore(state =>
    state.autoInvestigateWorktreeIds.size > 0 ||
    state.autoInvestigatePRWorktreeIds.size > 0
  )

  // Re-trigger effect when new worktree paths are registered.
  // Without this, the effect runs when the flag is set (before the worktree is ready),
  // skips because worktreePaths[id] is undefined, and never re-runs.
  const worktreePathCount = useChatStore(state =>
    Object.keys(state.worktreePaths).length
  )

  useEffect(() => {
    if (!hasAutoInvestigate) return

    const {
      autoInvestigateWorktreeIds,
      autoInvestigatePRWorktreeIds,
    } = useUIStore.getState()

    const { worktreePaths, activeWorktreeId } = useChatStore.getState()

    // Collect all worktree IDs that need background investigation
    const candidates: { worktreeId: string; type: 'issue' | 'pr' }[] = []

    for (const worktreeId of autoInvestigateWorktreeIds) {
      // Skip foreground worktrees — ChatWindow handles those
      if (worktreeId === activeWorktreeId) continue
      // Skip if worktree path not yet registered (still pending)
      if (!worktreePaths[worktreeId]) continue
      // Skip if already being processed
      if (processingRef.current.has(worktreeId)) continue
      candidates.push({ worktreeId, type: 'issue' })
    }

    for (const worktreeId of autoInvestigatePRWorktreeIds) {
      if (worktreeId === activeWorktreeId) continue
      if (!worktreePaths[worktreeId]) continue
      if (processingRef.current.has(worktreeId)) continue
      // Don't duplicate if already queued as issue
      if (candidates.some(c => c.worktreeId === worktreeId)) continue
      candidates.push({ worktreeId, type: 'pr' })
    }

    if (candidates.length === 0) return

    // Process each candidate
    for (const { worktreeId, type } of candidates) {
      processingRef.current.add(worktreeId)

      // Consume the flag immediately so we don't re-process
      const uiStore = useUIStore.getState()
      if (type === 'issue') {
        uiStore.consumeAutoInvestigate(worktreeId)
      } else {
        uiStore.consumeAutoInvestigatePR(worktreeId)
      }

      processBackgroundInvestigation(
        worktreeId,
        type,
        preferences,
        cliStatus?.version ?? null,
        queryClient,
      ).catch(err => {
        logger.error('Background investigation failed', { worktreeId, err })
      }).finally(() => {
        processingRef.current.delete(worktreeId)
      })
    }
  }, [hasAutoInvestigate, worktreePathCount, preferences, cliStatus?.version, queryClient])
}

/**
 * Process a single background investigation: fetch session, build prompt, enqueue message.
 */
async function processBackgroundInvestigation(
  worktreeId: string,
  type: 'issue' | 'pr',
  preferences: ReturnType<typeof usePreferences>['data'],
  cliVersion: string | null,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  const worktreePath = useChatStore.getState().worktreePaths[worktreeId]
  if (!worktreePath) return

  logger.info('Starting background investigation', { worktreeId, type })

  // Fetch sessions — auto-creates "Session 1" if none exist
  const sessions = await invoke<WorktreeSessions>('get_sessions', {
    worktreeId,
    worktreePath,
    includeMessageCounts: false,
  })

  const sessionId = sessions.active_session_id ?? sessions.sessions[0]?.id
  if (!sessionId) {
    logger.error('Background investigation: no session found', { worktreeId })
    return
  }

  // Register session-worktree mapping so useQueueProcessor can find the worktree
  const { setActiveSession } = useChatStore.getState()
  setActiveSession(worktreeId, sessionId)

  // Invalidate sessions query so ProjectCanvasView picks up the session
  queryClient.invalidateQueries({
    queryKey: chatQueryKeys.sessions(worktreeId),
  })

  // Build the investigation prompt
  let prompt: string

  if (type === 'issue') {
    const contexts = await invoke<{ number: number }[]>(
      'list_loaded_issue_contexts',
      { sessionId: worktreeId }
    )
    const refs = (contexts ?? []).map(c => `#${c.number}`).join(', ')
    const word = (contexts ?? []).length === 1 ? 'issue' : 'issues'
    const customPrompt = preferences?.magic_prompts?.investigate_issue
    const template =
      customPrompt && customPrompt.trim()
        ? customPrompt
        : DEFAULT_INVESTIGATE_ISSUE_PROMPT
    prompt = template
      .replace(/\{issueWord\}/g, word)
      .replace(/\{issueRefs\}/g, refs)
  } else {
    const contexts = await invoke<{ number: number }[]>(
      'list_loaded_pr_contexts',
      { sessionId: worktreeId }
    )
    const refs = (contexts ?? []).map(c => `#${c.number}`).join(', ')
    const word = (contexts ?? []).length === 1 ? 'PR' : 'PRs'
    const customPrompt = preferences?.magic_prompts?.investigate_pr
    const template =
      customPrompt && customPrompt.trim()
        ? customPrompt
        : DEFAULT_INVESTIGATE_PR_PROMPT
    prompt = template
      .replace(/\{prWord\}/g, word)
      .replace(/\{prRefs\}/g, refs)
  }

  // Resolve model, provider, backend
  const modelKey =
    type === 'issue' ? 'investigate_issue_model' : 'investigate_pr_model'
  const providerKey =
    type === 'issue' ? 'investigate_issue_provider' : 'investigate_pr_provider'

  const selectedModel =
    preferences?.magic_prompt_models?.[modelKey] ??
    preferences?.selected_model ??
    'sonnet'
  const provider = resolveMagicPromptProvider(
    preferences?.magic_prompt_providers,
    providerKey,
    preferences?.default_provider
  )
  const backend = resolveBackend(selectedModel)

  // Resolve custom profile name
  let customProfileName: string | undefined
  if (provider && provider !== '__anthropic__') {
    const profile = preferences?.custom_cli_profiles?.find(
      p => p.name === provider
    )
    customProfileName = profile?.name
  }

  // Set session config on backend
  await Promise.all([
    invoke('set_session_backend', {
      worktreeId,
      worktreePath,
      sessionId,
      backend,
    }),
    invoke('set_session_model', {
      worktreeId,
      worktreePath,
      sessionId,
      model: selectedModel,
    }),
    invoke('set_session_provider', {
      worktreeId,
      worktreePath,
      sessionId,
      provider,
    }),
  ])

  // Set Zustand state for the session
  const {
    setSelectedModel,
    setSelectedProvider,
    setSelectedBackend,
    setExecutingMode,
    enqueueMessage,
  } = useChatStore.getState()

  setSelectedModel(sessionId, selectedModel)
  setSelectedProvider(sessionId, provider)
  setSelectedBackend(sessionId, backend)
  setExecutingMode(sessionId, 'plan')

  // Determine adaptive thinking
  const isCustomProvider = Boolean(provider && provider !== '__anthropic__')
  const useAdaptive =
    !isCustomProvider && supportsAdaptiveThinking(selectedModel, cliVersion)

  // Build and enqueue the message
  const queuedMessage: QueuedMessage = {
    id: `bg-investigate-${worktreeId}-${Date.now()}`,
    message: prompt,
    pendingImages: [],
    pendingFiles: [],
    pendingSkills: [],
    pendingTextFiles: [],
    model: selectedModel,
    provider: customProfileName ?? null,
    executionMode: 'plan',
    thinkingLevel: 'think',
    effortLevel: useAdaptive ? 'high' : undefined,
    backend,
    queuedAt: Date.now(),
  }

  enqueueMessage(sessionId, queuedMessage)

  logger.info('Background investigation enqueued', {
    worktreeId,
    sessionId,
    type,
    model: selectedModel,
  })
}
