import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, CheckCircle2, CornerDownRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { navigateToSession } from '@/lib/navigate-to-session'
import { formatRelativeTime, toMilliseconds } from '@/lib/relative-time'
import { chatQueryKeys, dismissPlanHandoff, useSession } from '@/services/chat'
import { useWorktree } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import { useSessionRemoval } from './hooks/useSessionArchive'

interface PlanHandoffNoticeProps {
  messageId: string
  sessionId: string
  worktreeId: string
  worktreePath: string
}

/**
 * Notice under a plan that was sent to a new session or worktree.
 * Offers to mark the source session complete, archive it, or keep going here.
 */
export function PlanHandoffNotice({
  messageId,
  sessionId,
  worktreeId,
  worktreePath,
}: PlanHandoffNoticeProps) {
  const queryClient = useQueryClient()
  const { data: session } = useSession(sessionId, worktreeId, worktreePath)
  const { data: worktree } = useWorktree(worktreeId)
  const isCompleted = useChatStore(
    state => state.sessionStatusOverrides[sessionId] === 'completed'
  )
  const { archive } = useSessionRemoval()

  const handoff = session?.plan_handoffs?.find(h => h.message_id === messageId)

  const dismiss = useCallback(() => {
    queryClient.setQueryData<Session>(chatQueryKeys.session(sessionId), old => {
      if (!old) return old
      return {
        ...old,
        plan_handoffs: old.plan_handoffs?.map(h =>
          h.message_id === messageId ? { ...h, dismissed: true } : h
        ),
      }
    })
    dismissPlanHandoff(worktreeId, worktreePath, sessionId, messageId).catch(
      err => toast.error(`Failed to save: ${err}`)
    )
  }, [queryClient, sessionId, worktreeId, worktreePath, messageId])

  const handleOpen = useCallback(() => {
    if (!handoff || !worktree) return
    navigateToSession({
      projectId: worktree.project_id,
      worktreeId: handoff.target_worktree_id,
      sessionId: handoff.target_session_id,
    })
  }, [handoff, worktree])

  const handleComplete = useCallback(() => {
    useChatStore.getState().setSessionStatusOverride(sessionId, 'completed')
    dismiss()
  }, [sessionId, dismiss])

  const handleArchive = useCallback(() => {
    archive({ worktreeId, worktreePath, sessionId })
  }, [archive, worktreeId, worktreePath, sessionId])

  const handleContinue = useCallback(() => {
    dismiss()
    window.dispatchEvent(new CustomEvent('command:focus-chat-input'))
  }, [dismiss])

  if (!handoff) return null

  const targetName =
    handoff.kind === 'worktree'
      ? (handoff.target_worktree_name ?? 'new worktree')
      : (handoff.target_session_name ?? 'new session')
  const fullDate = new Date(toMilliseconds(handoff.created_at)).toLocaleString()
  const showOffer = !handoff.dismissed && !isCompleted

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
      <span>
        Plan sent to{' '}
        {handoff.kind === 'worktree' ? 'new worktree' : 'new session'}{' '}
        <button
          type="button"
          onClick={handleOpen}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {targetName}
        </button>{' '}
        ({handoff.mode}) ·{' '}
        <span title={fullDate}>
          {formatRelativeTime(handoff.created_at)} ({fullDate})
        </span>
      </span>
      {showOffer && (
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={handleComplete}
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Mark complete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={handleArchive}
          >
            <Archive className="mr-1 h-3.5 w-3.5" />
            Archive
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={handleContinue}
          >
            Continue here
          </Button>
        </span>
      )}
    </div>
  )
}
