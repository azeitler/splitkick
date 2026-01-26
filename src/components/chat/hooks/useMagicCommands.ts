import { useEffect, useLayoutEffect, useRef } from 'react'

interface MagicCommandHandlers {
  handleSaveContext: () => void
  handleLoadContext: () => void
  handleCommit: () => void
  handleCommitAndPush: () => void
  handleOpenPr: () => void
  handleReview: () => void
  handleMerge: () => void
  handleResolveConflicts: () => void
  handleInvestigateIssue: () => void
  handleInvestigatePR: () => void
}

/**
 * Listens for 'magic-command' custom events from MagicModal and dispatches to appropriate handlers.
 *
 * PERFORMANCE: Uses refs to keep event listener stable across handler changes.
 * The event listener is set up once and uses refs to access current handler versions.
 */
export function useMagicCommands({
  handleSaveContext,
  handleLoadContext,
  handleCommit,
  handleCommitAndPush,
  handleOpenPr,
  handleReview,
  handleMerge,
  handleResolveConflicts,
  handleInvestigateIssue,
  handleInvestigatePR,
}: MagicCommandHandlers): void {
  // Store handlers in ref so event listener always has access to current versions
  const handlersRef = useRef<MagicCommandHandlers>({
    handleSaveContext,
    handleLoadContext,
    handleCommit,
    handleCommitAndPush,
    handleOpenPr,
    handleReview,
    handleMerge,
    handleResolveConflicts,
    handleInvestigateIssue,
    handleInvestigatePR,
  })

  // Update refs in useLayoutEffect to avoid linter warning about ref updates during render
  // useLayoutEffect runs synchronously after render, ensuring refs are updated before effects
  useLayoutEffect(() => {
    handlersRef.current = {
      handleSaveContext,
      handleLoadContext,
      handleCommit,
      handleCommitAndPush,
      handleOpenPr,
      handleReview,
      handleMerge,
      handleResolveConflicts,
      handleInvestigateIssue,
      handleInvestigatePR,
    }
  })

  useEffect(() => {
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
        case 'investigate-issue':
          handlers.handleInvestigateIssue()
          break
        case 'investigate-pr':
          handlers.handleInvestigatePR()
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
  }, []) // Empty deps - stable listener using refs
}
