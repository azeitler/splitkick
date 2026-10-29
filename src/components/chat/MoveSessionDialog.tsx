import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { moveSession } from '@/lib/session-move'
import { invoke } from '@/lib/transport'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { Project, Worktree } from '@/types/projects'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Move a session to another worktree, in this or another project (issue #67).
 * Nothing is preselected: the user picks the project, then the worktree.
 */
export function MoveSessionDialog() {
  const target = useUIStore(state => state.moveSessionTarget)
  const [projectId, setProjectId] = useState('')
  const [worktreeId, setWorktreeId] = useState('')
  const isRunning = useChatStore(state =>
    target ? !!state.sendingSessionIds[target.sessionId] : false
  )
  const hasQueuedMessages = useChatStore(state =>
    target ? (state.messageQueues[target.sessionId]?.length ?? 0) > 0 : false
  )
  const blocker = isRunning
    ? 'This session is running. Wait for the turn to finish, then move it.'
    : hasQueuedMessages
      ? 'This session has queued messages. Send or remove them first.'
      : null

  const projects = useQuery({
    queryKey: ['session-move', 'projects'],
    enabled: !!target,
    queryFn: async () =>
      (await invoke<Project[]>('list_projects')).filter(
        project => !project.is_folder
      ),
  })

  const worktrees = useQuery({
    queryKey: ['session-move', 'worktrees', projectId],
    enabled: !!target && !!projectId,
    queryFn: async () =>
      (await invoke<Worktree[]>('list_worktrees', { projectId })).filter(
        worktree =>
          !worktree.archived_at && worktree.id !== target?.worktreeId
      ),
  })

  const close = () => {
    setProjectId('')
    setWorktreeId('')
    useUIStore.getState().setMoveSessionTarget(null)
  }

  const handleMove = () => {
    if (!target || !worktreeId || blocker) return
    const worktreeName =
      worktrees.data?.find(worktree => worktree.id === worktreeId)?.name ??
      'worktree'
    const { sessionId } = target
    close()
    const toastId = toast.loading(`Moving session to ${worktreeName}…`)
    moveSession(sessionId, worktreeId)
      .then(() => {
        toast.success(`Moved session to ${worktreeName}`, { id: toastId })
      })
      .catch(error => {
        toast.error(`Failed to move session: ${errorMessage(error)}`, {
          id: toastId,
        })
      })
  }

  const listError = projects.error ?? worktrees.error

  return (
    <Dialog open={target !== null} onOpenChange={open => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move Session</DialogTitle>
          <DialogDescription>
            Moves this session with its history to another worktree. It leaves
            the current worktree.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="move-project">Project</Label>
            <NativeSelect
              id="move-project"
              className="w-full"
              value={projectId}
              disabled={!projects.data?.length}
              onChange={event => {
                setProjectId(event.target.value)
                setWorktreeId('')
              }}
            >
              <NativeSelectOption value="" disabled>
                Select a project…
              </NativeSelectOption>
              {(projects.data ?? []).map(project => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor="move-worktree">Worktree</Label>
            <NativeSelect
              id="move-worktree"
              className="w-full"
              value={worktreeId}
              disabled={!worktrees.data?.length}
              onChange={event => setWorktreeId(event.target.value)}
            >
              <NativeSelectOption value="" disabled>
                {projectId && worktrees.data?.length === 0
                  ? 'No other worktree in this project'
                  : 'Select a worktree…'}
              </NativeSelectOption>
              {(worktrees.data ?? []).map(worktree => (
                <NativeSelectOption key={worktree.id} value={worktree.id}>
                  {worktree.name} ({worktree.branch})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {blocker || listError ? (
            <p className="text-sm text-destructive" role="alert">
              {blocker ?? errorMessage(listError)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Claude continues its conversation. Other backends get the history
              replayed on the next message. Checkpoint restore for earlier
              turns does not move with the session.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!worktreeId || !!blocker}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
