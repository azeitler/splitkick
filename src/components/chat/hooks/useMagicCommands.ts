import { useEffect, useLayoutEffect, useRef } from 'react'

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
}

interface UseMagicCommandsOptions extends MagicCommandHandlers {
  /** Whether this ChatWindow is rendered in modal mode */
  isModal?: boolean
  /** Whether the main ChatWindow is currently showing canvas tab */
  isViewingCanvasTab?: boolean
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
  isModal = false,
  isViewingCanvasTab = false,
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
    }
  })

  useEffect(() => {
    // If main ChatWindow is showing canvas view, don't register listener here.
    // The modal ChatWindow (inside SessionChatModal) will handle events instead.
    // This prevents duplicate event handling when both ChatWindow instances exist.
    if (!isModal && isViewingCanvasTab) {
      return
    }

    const handleMagicCommand = (e: CustomEvent<{ command: string }>) => {
      const { command } = e.detail
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
  }, [isModal, isViewingCanvasTab]) // Re-register when modal/canvas state changes
}
