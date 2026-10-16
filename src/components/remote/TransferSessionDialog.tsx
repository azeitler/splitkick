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
import { PRODUCT_NAME } from '@/lib/build-info'
import { activateConnection } from '@/lib/connection-windows'
import { remoteInvoke } from '@/lib/remote-invoke'
import { transferSession, useTransferTargets } from '@/lib/session-transfer'
import { invoke } from '@/lib/transport'
import { useUIStore } from '@/store/ui-store'
import type { Project, Worktree } from '@/types/projects'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A user's choice while it is still in the list, else the preselected value. */
function pick<T extends { id: string }>(
  items: T[],
  choice: string,
  preferred: (item: T) => boolean
): string {
  if (items.some(item => item.id === choice)) return choice
  return (items.find(preferred) ?? items[0])?.id ?? ''
}

/**
 * Copy a session, with its history, to another Jean (issue #35): pick the
 * connection, then the remote project and worktree. Preselects the project with
 * the same name and the worktree on the same branch as the local one.
 */
export function TransferSessionDialog() {
  const target = useUIStore(state => state.transferSessionTarget)
  const targets = useTransferTargets()
  const [connectionChoice, setConnectionChoice] = useState('')
  const [projectChoice, setProjectChoice] = useState('')
  const [worktreeChoice, setWorktreeChoice] = useState('')

  const connectionId = pick(targets, connectionChoice, () => false)
  const connection = targets.find(item => item.id === connectionId) ?? null

  const local = useQuery({
    queryKey: ['session-transfer', 'local', target?.worktreeId],
    enabled: !!target,
    queryFn: async () => {
      const worktree = await invoke<Worktree>('get_worktree', {
        worktreeId: target?.worktreeId,
      })
      const projects = await invoke<Project[]>('list_projects')
      return {
        branch: worktree.branch,
        projectName:
          projects.find(project => project.id === worktree.project_id)?.name ??
          null,
      }
    },
  })

  const remoteProjects = useQuery({
    queryKey: ['session-transfer', connectionId, 'projects'],
    enabled: !!target && !!connection,
    retry: false,
    queryFn: async () => {
      if (!connection) return []
      const projects = await remoteInvoke<Project[]>(
        connection,
        'list_projects'
      )
      return projects.filter(project => !project.is_folder)
    },
  })
  const projectId = pick(
    remoteProjects.data ?? [],
    projectChoice,
    project => project.name === local.data?.projectName
  )

  const remoteWorktrees = useQuery({
    queryKey: ['session-transfer', connectionId, 'worktrees', projectId],
    enabled: !!target && !!connection && !!projectId,
    retry: false,
    queryFn: () =>
      connection
        ? remoteInvoke<Worktree[]>(connection, 'list_worktrees', { projectId })
        : Promise.resolve([]),
  })
  const worktreeId = pick(
    remoteWorktrees.data ?? [],
    worktreeChoice,
    worktree => worktree.branch === local.data?.branch
  )

  const close = () => {
    setConnectionChoice('')
    setProjectChoice('')
    setWorktreeChoice('')
    useUIStore.getState().setTransferSessionTarget(null)
  }

  const handleTransfer = () => {
    if (!target || !connection || !worktreeId) return
    const request = { ...target, connection, targetWorktreeId: worktreeId }
    close()
    const toastId = toast.loading(`Transferring session to ${connection.name}…`)
    transferSession(request)
      .then(session => {
        toast.success(`Session transferred to ${connection.name}`, {
          id: toastId,
          description: session.name,
          action: {
            label: 'Open',
            onClick: () => void activateConnection(connection.id),
          },
        })
      })
      .catch(error => {
        toast.error(`Transfer failed: ${errorMessage(error)}`, { id: toastId })
      })
  }

  const listError = remoteProjects.error ?? remoteWorktrees.error

  return (
    <Dialog open={target !== null} onOpenChange={open => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer to Remote {PRODUCT_NAME}</DialogTitle>
          <DialogDescription>
            Copies this session with its history. The session here does not
            change.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="transfer-connection">Connection</Label>
            <NativeSelect
              id="transfer-connection"
              className="w-full"
              value={connectionId}
              onChange={event => {
                setConnectionChoice(event.target.value)
                setProjectChoice('')
                setWorktreeChoice('')
              }}
            >
              {targets.map(item => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-project">Project</Label>
            <NativeSelect
              id="transfer-project"
              className="w-full"
              value={projectId}
              disabled={!remoteProjects.data?.length}
              onChange={event => {
                setProjectChoice(event.target.value)
                setWorktreeChoice('')
              }}
            >
              {(remoteProjects.data ?? []).map(project => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-worktree">Worktree</Label>
            <NativeSelect
              id="transfer-worktree"
              className="w-full"
              value={worktreeId}
              disabled={!remoteWorktrees.data?.length}
              onChange={event => setWorktreeChoice(event.target.value)}
            >
              {(remoteWorktrees.data ?? []).map(worktree => (
                <NativeSelectOption key={worktree.id} value={worktree.id}>
                  {worktree.name} ({worktree.branch})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {listError ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage(listError)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The remote worktree must have your code. Push the branch first,
              then pull it there.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={handleTransfer} disabled={!worktreeId}>
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
