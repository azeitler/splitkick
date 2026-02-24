import { useCallback, useRef, useState } from 'react'
import { invoke } from '@/lib/transport'
import { toast } from 'sonner'
import {
  loadIssueContext,
  removeIssueContext,
  loadPRContext,
  removePRContext,
  attachSavedContext,
  removeSavedContext,
  getSavedContextContent,
} from '@/services/github'
import { resolveMagicPromptProvider } from '@/types/preferences'
import type { SavedContext, SaveContextResponse } from '@/types/chat'
import type {
  LoadedIssueContext,
  LoadedPullRequestContext,
  GitHubIssue,
  GitHubPullRequest,
  AttachedSavedContext,
} from '@/types/github'
import type { MagicPromptProviders } from '@/types/preferences'
import type { SessionWithContext } from '../LoadContextItems'

export interface ViewingContext {
  type: 'issue' | 'pr' | 'saved'
  number?: number
  slug?: string
  title: string
  content: string
}

interface UseLoadContextHandlersOptions {
  activeSessionId: string | null
  worktreePath: string | null
  refetchIssueContexts: () => void
  refetchPRContexts: () => void
  refetchAttachedContexts: () => void
  refetchContexts: () => void
  renameMutation: { mutate: (args: { filename: string; newName: string }) => void }
  preferences:
    | {
        magic_prompts?: { context_summary?: string | null }
        magic_prompt_models?: { context_summary_model?: string | null }
        magic_prompt_providers?: MagicPromptProviders
        default_provider?: string | null
      }
    | undefined
  onClearSearch: () => void
}

export function useLoadContextHandlers({
  activeSessionId,
  worktreePath,
  refetchIssueContexts,
  refetchPRContexts,
  refetchAttachedContexts,
  refetchContexts,
  renameMutation,
  preferences,
  onClearSearch,
}: UseLoadContextHandlersOptions) {
  // In-flight tracking state
  const [loadingNumbers, setLoadingNumbers] = useState<Set<number>>(new Set())
  const [removingNumbers, setRemovingNumbers] = useState<Set<number>>(new Set())
  const [loadingSlugs, setLoadingSlugs] = useState<Set<string>>(new Set())
  const [removingSlugs, setRemovingSlugs] = useState<Set<string>>(new Set())
  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(null)

  // Inline edit state
  const [editingFilename, setEditingFilename] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // Context viewer state
  const [viewingContext, setViewingContext] = useState<ViewingContext | null>(null)

  // Reset all in-flight state (called when modal opens)
  const resetState = useCallback(() => {
    setLoadingNumbers(new Set())
    setRemovingNumbers(new Set())
    setLoadingSlugs(new Set())
    setRemovingSlugs(new Set())
    setGeneratingSessionId(null)
    setEditingFilename(null)
    setEditValue('')
  }, [])

  // Issue handlers
  const handleLoadIssue = useCallback(
    async (issueNumber: number, isRefresh = false) => {
      if (!activeSessionId || !worktreePath) {
        toast.error('No active session')
        return
      }

      setLoadingNumbers(prev => new Set(prev).add(issueNumber))
      const toastId = toast.loading(
        isRefresh
          ? `Refreshing issue #${issueNumber}...`
          : `Loading issue #${issueNumber}...`
      )

      try {
        const result = await loadIssueContext(activeSessionId, issueNumber, worktreePath)
        await refetchIssueContexts()
        toast.success(
          `Issue #${result.number}: ${result.title}${result.commentCount > 0 ? ` (${result.commentCount} comments)` : ''}`,
          { id: toastId }
        )
      } catch (error) {
        toast.error(`${error}`, { id: toastId })
      } finally {
        setLoadingNumbers(prev => {
          const next = new Set(prev)
          next.delete(issueNumber)
          return next
        })
      }
    },
    [activeSessionId, worktreePath, refetchIssueContexts]
  )

  const handleRemoveIssue = useCallback(
    async (issueNumber: number) => {
      if (!activeSessionId || !worktreePath) return

      setRemovingNumbers(prev => new Set(prev).add(issueNumber))
      try {
        await removeIssueContext(activeSessionId, issueNumber, worktreePath)
        await refetchIssueContexts()
        toast.success(`Removed issue #${issueNumber} from context`)
      } catch (error) {
        toast.error(`Failed to remove issue: ${error}`)
      } finally {
        setRemovingNumbers(prev => {
          const next = new Set(prev)
          next.delete(issueNumber)
          return next
        })
      }
    },
    [activeSessionId, worktreePath, refetchIssueContexts]
  )

  const handleViewIssue = useCallback((ctx: LoadedIssueContext) => {
    setViewingContext({ type: 'issue', number: ctx.number, title: ctx.title, content: '' })
  }, [])

  const handlePreviewIssue = useCallback((issue: GitHubIssue) => {
    setViewingContext({ type: 'issue', number: issue.number, title: issue.title, content: '' })
  }, [])

  const handleSelectIssue = useCallback(
    (issue: GitHubIssue) => {
      handleLoadIssue(issue.number, false)
      onClearSearch()
    },
    [handleLoadIssue, onClearSearch]
  )

  // PR handlers
  const handleLoadPR = useCallback(
    async (prNumber: number, isRefresh = false) => {
      if (!activeSessionId || !worktreePath) {
        toast.error('No active session')
        return
      }

      setLoadingNumbers(prev => new Set(prev).add(prNumber))
      const toastId = toast.loading(
        isRefresh
          ? `Refreshing PR #${prNumber}...`
          : `Loading PR #${prNumber}...`
      )

      try {
        const result = await loadPRContext(activeSessionId, prNumber, worktreePath)
        await refetchPRContexts()
        toast.success(
          `PR #${result.number}: ${result.title}${result.commentCount > 0 ? ` (${result.commentCount} comments)` : ''}${result.reviewCount > 0 ? `, ${result.reviewCount} reviews` : ''}`,
          { id: toastId }
        )
      } catch (error) {
        toast.error(`${error}`, { id: toastId })
      } finally {
        setLoadingNumbers(prev => {
          const next = new Set(prev)
          next.delete(prNumber)
          return next
        })
      }
    },
    [activeSessionId, worktreePath, refetchPRContexts]
  )

  const handleRemovePR = useCallback(
    async (prNumber: number) => {
      if (!activeSessionId || !worktreePath) return

      setRemovingNumbers(prev => new Set(prev).add(prNumber))
      try {
        await removePRContext(activeSessionId, prNumber, worktreePath)
        await refetchPRContexts()
        toast.success(`Removed PR #${prNumber} from context`)
      } catch (error) {
        toast.error(`Failed to remove PR: ${error}`)
      } finally {
        setRemovingNumbers(prev => {
          const next = new Set(prev)
          next.delete(prNumber)
          return next
        })
      }
    },
    [activeSessionId, worktreePath, refetchPRContexts]
  )

  const handleViewPR = useCallback((ctx: LoadedPullRequestContext) => {
    setViewingContext({ type: 'pr', number: ctx.number, title: ctx.title, content: '' })
  }, [])

  const handlePreviewPR = useCallback((pr: GitHubPullRequest) => {
    setViewingContext({ type: 'pr', number: pr.number, title: pr.title, content: '' })
  }, [])

  const handleSelectPR = useCallback(
    (pr: GitHubPullRequest) => {
      handleLoadPR(pr.number, false)
      onClearSearch()
    },
    [handleLoadPR, onClearSearch]
  )

  // Context handlers
  const handleDeleteContext = useCallback(
    async (e: React.MouseEvent, context: SavedContext) => {
      e.stopPropagation()
      try {
        await invoke('delete_context_file', { path: context.path })
        refetchContexts()
      } catch (err) {
        console.error('Failed to delete context:', err)
      }
    },
    [refetchContexts]
  )

  const handleAttachContext = useCallback(
    async (context: SavedContext) => {
      if (!activeSessionId) {
        toast.error('No active session')
        return
      }

      setLoadingSlugs(prev => new Set(prev).add(context.slug))
      const toastId = toast.loading(
        `Attaching context "${context.name || context.slug}"...`
      )

      try {
        await attachSavedContext(activeSessionId, context.path, context.slug)
        await refetchAttachedContexts()
        toast.success(`Context "${context.name || context.slug}" attached`, {
          id: toastId,
        })
        onClearSearch()
      } catch (error) {
        toast.error(`${error}`, { id: toastId })
      } finally {
        setLoadingSlugs(prev => {
          const next = new Set(prev)
          next.delete(context.slug)
          return next
        })
      }
    },
    [activeSessionId, refetchAttachedContexts, onClearSearch]
  )

  const handleRemoveAttachedContext = useCallback(
    async (slug: string) => {
      if (!activeSessionId) return

      setRemovingSlugs(prev => new Set(prev).add(slug))
      try {
        await removeSavedContext(activeSessionId, slug)
        await refetchAttachedContexts()
        toast.success(`Removed context "${slug}"`)
      } catch (error) {
        toast.error(`Failed to remove context: ${error}`)
      } finally {
        setRemovingSlugs(prev => {
          const next = new Set(prev)
          next.delete(slug)
          return next
        })
      }
    },
    [activeSessionId, refetchAttachedContexts]
  )

  const handleViewAttachedContext = useCallback(
    async (ctx: AttachedSavedContext) => {
      if (!activeSessionId) return
      try {
        const content = await getSavedContextContent(activeSessionId, ctx.slug)
        setViewingContext({
          type: 'saved',
          slug: ctx.slug,
          title: ctx.name || ctx.slug,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [activeSessionId]
  )

  const handleStartEdit = useCallback(
    (e: React.MouseEvent, context: SavedContext) => {
      e.stopPropagation()
      setEditingFilename(context.filename)
      setEditValue(context.name || context.slug)
    },
    []
  )

  const handleRenameSubmit = useCallback(
    (filename: string) => {
      const newName = editValue.trim()
      renameMutation.mutate({ filename, newName })
      setEditingFilename(null)
    },
    [editValue, renameMutation]
  )

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent, filename: string) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleRenameSubmit(filename)
      } else if (e.key === 'Escape') {
        setEditingFilename(null)
      } else if (e.key === ' ') {
        e.stopPropagation()
      }
    },
    [handleRenameSubmit]
  )

  const handleSessionClick = useCallback(
    async (sessionWithContext: SessionWithContext) => {
      const {
        session,
        worktreeId: sessionWorktreeId,
        worktreePath: sessionWorktreePath,
        projectName: sessionProjectName,
      } = sessionWithContext

      if (!activeSessionId) {
        toast.error('No active session')
        return
      }

      setGeneratingSessionId(session.id)
      try {
        const result = await invoke<SaveContextResponse>(
          'generate_context_from_session',
          {
            worktreePath: sessionWorktreePath,
            worktreeId: sessionWorktreeId,
            sourceSessionId: session.id,
            projectName: sessionProjectName,
            customPrompt: preferences?.magic_prompts?.context_summary,
            model: preferences?.magic_prompt_models?.context_summary_model,
            customProfileName: resolveMagicPromptProvider(
              preferences?.magic_prompt_providers,
              'context_summary_provider',
              preferences?.default_provider
            ),
          }
        )

        refetchContexts()

        const slug = result.filename
          .split('-')
          .slice(2)
          .join('-')
          .replace('.md', '')

        await attachSavedContext(activeSessionId, result.path, slug)
        await refetchAttachedContexts()

        toast.success(`Context created and attached: ${result.filename}`)
        onClearSearch()
      } catch (err) {
        console.error('Failed to generate context:', err)
        toast.error(`Failed to generate context: ${err}`)
      } finally {
        setGeneratingSessionId(null)
      }
    },
    [
      activeSessionId,
      refetchContexts,
      refetchAttachedContexts,
      preferences?.magic_prompts?.context_summary,
      preferences?.magic_prompt_models?.context_summary_model,
      preferences?.magic_prompt_providers,
      preferences?.default_provider,
      onClearSearch,
    ]
  )

  return {
    // In-flight tracking
    loadingNumbers,
    removingNumbers,
    loadingSlugs,
    removingSlugs,
    generatingSessionId,

    // Edit state
    editingFilename,
    editValue,
    setEditValue,
    editInputRef,

    // Context viewer
    viewingContext,
    setViewingContext,

    // Reset
    resetState,

    // Issue handlers
    handleLoadIssue,
    handleRemoveIssue,
    handleViewIssue,
    handlePreviewIssue,
    handleSelectIssue,

    // PR handlers
    handleLoadPR,
    handleRemovePR,
    handleViewPR,
    handlePreviewPR,
    handleSelectPR,

    // Context/session handlers
    handleDeleteContext,
    handleAttachContext,
    handleRemoveAttachedContext,
    handleViewAttachedContext,
    handleStartEdit,
    handleRenameSubmit,
    handleRenameKeyDown,
    handleSessionClick,
  }
}
