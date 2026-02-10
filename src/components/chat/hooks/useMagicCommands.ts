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
  handleReview: () => void
  handleMerge: () => void
  handleResolveConflicts: () => void
  handleInvestigate: () => void
  handleCheckoutPR: () => void
  handleInvestigateWorkflowRun: (detail: WorkflowRunDetail) => void
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
  handleInvestigate,
  handleCheckoutPR,
  handleInvestigateWorkflowRun,
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
    handleInvestigate,
    handleCheckoutPR,
    handleInvestigateWorkflowRun,
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
      handleInvestigate,
      handleCheckoutPR,
      handleInvestigateWorkflowRun,
    }
  })

  useEffect(() => {
    // If main ChatWindow is showing canvas view AND a session modal is open,
    // don't register listener here — the modal ChatWindow will handle events instead.
    // When on canvas WITHOUT a modal, the main ChatWindow still listens (for canvas-allowed commands).
    if (!isModal && isViewingCanvasTab && sessionModalOpen) {
      console.warn('[MAGIC-CMD] Skipping listener registration (main + canvas + modal open)')
      return
    }
    console.warn('[MAGIC-CMD] Registering listener:', { isModal, isViewingCanvasTab, sessionModalOpen })

    const handleMagicCommand = (
      e: CustomEvent<{ command: string } & Partial<WorkflowRunDetail>>
    ) => {
      const { command, ...rest } = e.detail
      console.warn('[MAGIC-CMD] Received:', command, { isModal, isViewingCanvasTab, sessionModalOpen, rest })
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
          handlers.handleReview()
          break
        case 'merge':
          handlers.handleMerge()
          break
        case 'resolve-conflicts':
          handlers.handleResolveConflicts()
          break
        case 'investigate':
          handlers.handleInvestigate()
          break
        case 'checkout-pr':
          handlers.handleCheckoutPR()
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
