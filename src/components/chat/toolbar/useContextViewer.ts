import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type {
  AttachedSavedContext,
  LoadedIssueContext,
  LoadedPullRequestContext,
} from '@/types/github'
import {
  getIssueContextContent,
  getPRContextContent,
  getSavedContextContent,
} from '@/services/github'
import type { ViewingContext } from '@/components/chat/toolbar/types'

interface UseContextViewerArgs {
  activeSessionId: string | null | undefined
  activeWorktreePath: string | undefined
}

export function useContextViewer({
  activeSessionId,
  activeWorktreePath,
}: UseContextViewerArgs) {
  const [viewingContext, setViewingContext] = useState<ViewingContext | null>(null)

  const handleViewIssue = useCallback(
    async (ctx: LoadedIssueContext) => {
      if (!activeSessionId || !activeWorktreePath) return
      try {
        const content = await getIssueContextContent(
          activeSessionId,
          ctx.number,
          activeWorktreePath
        )
        setViewingContext({
          type: 'issue',
          number: ctx.number,
          title: ctx.title,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [activeSessionId, activeWorktreePath]
  )

  const handleViewPR = useCallback(
    async (ctx: LoadedPullRequestContext) => {
      if (!activeSessionId || !activeWorktreePath) return
      try {
        const content = await getPRContextContent(
          activeSessionId,
          ctx.number,
          activeWorktreePath
        )
        setViewingContext({
          type: 'pr',
          number: ctx.number,
          title: ctx.title,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [activeSessionId, activeWorktreePath]
  )

  const handleViewSavedContext = useCallback(
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

  return {
    viewingContext,
    setViewingContext,
    handleViewIssue,
    handleViewPR,
    handleViewSavedContext,
  }
}
