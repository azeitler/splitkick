import { useEffect, useLayoutEffect, useRef } from 'react'

export interface WorkflowRunDetail {
  workflowName: string
  runUrl: string
  runId: string
  branch: string
  displayTitle: string
  projectPath: string | null
}

interface MagicCommandHandlers {
  handleSaveContext: () => void
  handleLoadContext: () => void
  handleCommit: () => void
  handleCommitAndPush: () => void
  handlePull: () => void
  handlePush: () => void
  handleOpenPr: () => void
  handleReview: (existingSessionId?: string) => void
  handleMerge: () => void
  handleResolveConflicts: () => void
  handleInvestigateWorkflowRun: (detail: WorkflowRunDetail) => void
  handleInvestigate: (type: 'issue' | 'pr') => void
}

interface UseMagicCommandsOptions extends MagicCommandHandlers {
  /** Whether this ChatWindow is rendered in modal mode */
  isModal?: boolean
  /** Whether the main ChatWindow is currently showing canvas tab */
  isViewingCanvasTab?: boolean
  /** Whether the session chat modal is currently open */
  sessionModalOpen?: boolean
}

/**
 * Listens for 'magic-command' custom events from MagicModal and dispatches to appropriate handlers.
 *
 * PERFORMANCE: Uses refs to keep event listener stable across handler changes.
 * The event listener is set up once and uses refs to access current handler versions.
 *
 * DEDUPLICATION: When main ChatWindow shows canvas view, it skips listener registration.
 * The modal ChatWindow (inside SessionChatModal) will handle events instead.
 */
export function useMagicCommands({
  handleSaveContext,
  handleLoadContext,
  handleCommit,
  handleCommitAndPush,
  handlePull,
  handlePush,
  handleOpenPr,
  handleReview,
  handleMerge,
  handleResolveConflicts,
  handleInvestigateWorkflowRun,
  handleInvestigate,
  isModal = false,
  isViewingCanvasTab = false,
  sessionModalOpen = false,
}: UseMagicCommandsOptions): void {
  // Store handlers in ref so event listener always has access to current versions
  const handlersRef = useRef<MagicCommandHandlers>({
    handleSaveContext,
    handleLoadContext,
    handleCommit,
    handleCommitAndPush,
    handlePull,
    handlePush,
    handleOpenPr,
    handleReview,
    handleMerge,
    handleResolveConflicts,
    handleInvestigateWorkflowRun,
    handleInvestigate,
  })

  // Update refs in useLayoutEffect to avoid linter warning about ref updates during render
  // useLayoutEffect runs synchronously after render, ensuring refs are updated before effects
  useLayoutEffect(() => {
    handlersRef.current = {
      handleSaveContext,
      handleLoadContext,
      handleCommit,
      handleCommitAndPush,
      handlePull,
      handlePush,
      handleOpenPr,
      handleReview,
      handleMerge,
      handleResolveConflicts,
      handleInvestigateWorkflowRun,
      handleInvestigate,
    }
  })

  useEffect(() => {
    // If main ChatWindow is showing canvas view AND a session modal is open,
    // don't register listener here — the modal ChatWindow will handle events instead.
    // When on canvas WITHOUT a modal, the main ChatWindow still listens (for canvas-allowed commands).
    if (!isModal && isViewingCanvasTab && sessionModalOpen) {
      return
    }

    const handleMagicCommand = (
      e: CustomEvent<{ command: string; sessionId?: string } & Partial<WorkflowRunDetail>>
    ) => {
      const { command, sessionId, ...rest } = e.detail
      const handlers = handlersRef.current
      switch (command) {
        case 'save-context':
          handlers.handleSaveContext()
          break
        case 'load-context':
          handlers.handleLoadContext()
          break
        case 'commit':
          handlers.handleCommit()
          break
        case 'commit-and-push':
          handlers.handleCommitAndPush()
          break
        case 'pull':
          handlers.handlePull()
          break
        case 'push':
          handlers.handlePush()
          break
        case 'open-pr':
          handlers.handleOpenPr()
          break
        case 'review':
          handlers.handleReview(sessionId)
          break
        case 'merge':
          handlers.handleMerge()
          break
        case 'resolve-conflicts':
          handlers.handleResolveConflicts()
          break
        case 'investigate':
          handlers.handleInvestigate((rest as { type: 'issue' | 'pr' }).type ?? 'issue')
          break
        case 'investigate-workflow-run':
          handlers.handleInvestigateWorkflowRun(rest as WorkflowRunDetail)
          break
      }
    }

    window.addEventListener(
      'magic-command',
      handleMagicCommand as EventListener
    )
    return () =>
      window.removeEventListener(
        'magic-command',
        handleMagicCommand as EventListener
      )
  }, [isModal, isViewingCanvasTab, sessionModalOpen]) // Re-register when modal/canvas state changes
}
