import { useCallback, type RefObject } from 'react'
import { invoke } from '@/lib/transport'
import { useChatStore, DEFAULT_MODEL } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { chatQueryKeys } from '@/services/chat'
import type { QueryClient } from '@tanstack/react-query'
import type {
  ThinkingLevel,
  EffortLevel,
  ExecutionMode,
  Session,
} from '@/types/chat'

interface UseToolbarHandlersParams {
  activeSessionId: string | null | undefined
  activeWorktreeId: string | null | undefined
  activeWorktreePath: string | null | undefined
  activeSessionIdRef: RefObject<string | null | undefined>
  activeWorktreeIdRef: RefObject<string | null | undefined>
  activeWorktreePathRef: RefObject<string | null | undefined>
  enabledMcpServersRef: RefObject<string[]>
  selectedBackend: 'claude' | 'codex' | 'opencode'
  installedBackends: ('claude' | 'codex' | 'opencode')[]
  session: Session | null | undefined
  preferences:
    | {
        selected_model?: string
        selected_codex_model?: string
        selected_opencode_model?: string
        custom_cli_profiles?: { name: string }[]
      }
    | undefined
  queryClient: QueryClient
  worktreeProjectId: string | undefined
  // Mutations (use any for compatibility with TanStack Query mutation types)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionModel: { mutate: (args: any, opts?: any) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionBackend: { mutate: (args: any, opts?: any) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionProvider: { mutate: (args: any) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionThinkingLevel: { mutate: (args: any) => void }
  setExecutionMode: (sessionId: string, mode: ExecutionMode) => void
  setLoadContextModalOpen: (open: boolean) => void
}

/**
 * Groups all ChatToolbar callback handlers.
 * These persist session settings (model, backend, provider, thinking level, etc.)
 * to both Zustand store and Rust backend.
 */
export function useToolbarHandlers({
  activeSessionId,
  activeWorktreeId,
  activeWorktreePath,
  activeSessionIdRef,
  activeWorktreeIdRef,
  activeWorktreePathRef,
  enabledMcpServersRef,
  selectedBackend,
  installedBackends,
  session,
  preferences,
  queryClient,
  worktreeProjectId,
  setSessionModel,
  setSessionBackend,
  setSessionProvider,
  setSessionThinkingLevel,
  setExecutionMode,
  setLoadContextModalOpen,
}: UseToolbarHandlersParams) {
  const handleToolbarModelChange = useCallback(
    (model: string) => {
      if (activeSessionId && activeWorktreeId && activeWorktreePath) {
        setSessionModel.mutate({
          sessionId: activeSessionId,
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
          model,
        })
        invoke('broadcast_session_setting', {
          sessionId: activeSessionId,
          key: 'model',
          value: model,
        }).catch(() => undefined)
      }
    },
    [activeSessionId, activeWorktreeId, activeWorktreePath, setSessionModel]
  )

  const handleToolbarBackendChange = useCallback(
    (backend: 'claude' | 'codex' | 'opencode') => {
      if (activeSessionId && activeWorktreeId && activeWorktreePath) {
        useChatStore.getState().setSelectedBackend(activeSessionId, backend)
        const model =
          backend === 'codex'
            ? (preferences?.selected_codex_model ?? 'gpt-5.3-codex')
            : backend === 'opencode'
              ? (preferences?.selected_opencode_model ?? 'opencode/gpt-5.2-codex')
              : ((preferences?.selected_model as string) ?? DEFAULT_MODEL)
        queryClient.setQueryData(
          chatQueryKeys.session(activeSessionId),
          (old: Session | null | undefined) =>
            old ? { ...old, backend, selected_model: model } : old
        )
        setSessionBackend.mutate(
          {
            sessionId: activeSessionId,
            worktreeId: activeWorktreeId,
            worktreePath: activeWorktreePath,
            backend,
          },
          {
            onSuccess: () => {
              setSessionModel.mutate({
                sessionId: activeSessionId,
                worktreeId: activeWorktreeId,
                worktreePath: activeWorktreePath,
                model,
              })
            },
          }
        )
      }
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      preferences?.selected_model,
      preferences?.selected_codex_model,
      preferences?.selected_opencode_model,
      queryClient,
      setSessionBackend,
      setSessionModel,
    ]
  )

  const handleTabBackendSwitch = useCallback(() => {
    if ((session?.messages?.length ?? 0) > 0) return
    if (installedBackends.length <= 1) return
    const currentIndex = installedBackends.indexOf(selectedBackend)
    const nextIndex = (currentIndex + 1) % installedBackends.length
    const nextBackend = installedBackends[nextIndex]
    if (nextBackend) handleToolbarBackendChange(nextBackend)
  }, [session?.messages?.length, selectedBackend, installedBackends, handleToolbarBackendChange])

  const handleToolbarProviderChange = useCallback(
    (provider: string | null) => {
      if (activeSessionId) {
        useChatStore.getState().setSelectedProvider(activeSessionId, provider)
        if (activeWorktreeId && activeWorktreePath) {
          setSessionProvider.mutate({
            sessionId: activeSessionId,
            worktreeId: activeWorktreeId,
            worktreePath: activeWorktreePath,
            provider,
          })
        }
      }
    },
    [activeSessionId, activeWorktreeId, activeWorktreePath, setSessionProvider]
  )

  const handleToolbarThinkingLevelChange = useCallback(
    (level: ThinkingLevel) => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      useChatStore.getState().setThinkingLevel(sessionId, level)
      setSessionThinkingLevel.mutate({
        sessionId,
        worktreeId,
        worktreePath,
        thinkingLevel: level,
      })
      invoke('broadcast_session_setting', {
        sessionId,
        key: 'thinkingLevel',
        value: level,
      }).catch(() => undefined)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate is stable, refs used for IDs
    []
  )

  const handleToolbarEffortLevelChange = useCallback((level: EffortLevel) => {
    const sessionId = activeSessionIdRef.current
    if (!sessionId) return
    useChatStore.getState().setEffortLevel(sessionId, level)
  }, [])

  const handleToggleMcpServer = useCallback((serverName: string) => {
    const sessionId = activeSessionIdRef.current
    if (!sessionId) return
    useChatStore
      .getState()
      .toggleMcpServer(sessionId, serverName, enabledMcpServersRef.current)
  }, [])

  const handleOpenProjectSettings = useCallback(() => {
    if (!worktreeProjectId) return
    useProjectsStore.getState().openProjectSettings(worktreeProjectId)
  }, [worktreeProjectId])

  const handleToolbarSetExecutionMode = useCallback(
    (mode: ExecutionMode) => {
      if (activeSessionId) {
        setExecutionMode(activeSessionId, mode)
        invoke('broadcast_session_setting', {
          sessionId: activeSessionId,
          key: 'executionMode',
          value: mode,
        }).catch(() => undefined)
      }
    },
    [activeSessionId, setExecutionMode]
  )

  const handleOpenMagicModal = useCallback(() => {
    useUIStore.getState().setMagicModalOpen(true)
  }, [])

  const handleLoadContextModalChange = useCallback(
    (open: boolean) => {
      setLoadContextModalOpen(open)
    },
    [setLoadContextModalOpen]
  )

  return {
    handleToolbarModelChange,
    handleToolbarBackendChange,
    handleTabBackendSwitch,
    handleToolbarProviderChange,
    handleToolbarThinkingLevelChange,
    handleToolbarEffortLevelChange,
    handleToggleMcpServer,
    handleOpenProjectSettings,
    handleToolbarSetExecutionMode,
    handleOpenMagicModal,
    handleLoadContextModalChange,
  }
}
