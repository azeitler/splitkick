import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { usePreferences } from '@/services/preferences'
import { useUIStore } from '@/store/ui-store'

interface CloseWorktreeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  branchName?: string
  mode?: 'worktree' | 'session'
}

export function CloseWorktreeDialog({
  open,
  onOpenChange,
  onConfirm,
  branchName,
  mode = 'worktree',
}: CloseWorktreeDialogProps) {
  if (!open) return null

  return (
    <CloseWorktreeDialogContent
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      branchName={branchName}
      mode={mode}
    />
  )
}

function CloseWorktreeDialogContent({
  open,
  onOpenChange,
  onConfirm,
  branchName,
  mode = 'worktree',
}: CloseWorktreeDialogProps) {
  const { data: preferences } = usePreferences()
  const isDelete = (preferences?.removal_behavior ?? 'archive') === 'delete'
  const isSession = mode === 'session'
  const title = isSession
    ? isDelete
      ? 'Delete session?'
      : 'Archive session?'
    : `${isDelete ? 'Delete worktree' : 'Archive & close worktree'}${branchName ? ` “${branchName}”` : ''}?`

  const description = isSession
    ? `This will ${isDelete ? 'permanently delete' : 'archive'} this session.`
    : branchName
      ? `This will ${isDelete ? 'permanently delete' : 'archive and close'} the "${branchName}" worktree and all its sessions.`
      : `This will ${isDelete ? 'permanently delete' : 'archive and close'} the worktree and all its sessions.`

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={isDelete ? 'Delete' : 'Archive & Close'}
      destructive={isDelete}
      onConfirm={onConfirm}
    >
      {isDelete && (
        <p className="text-xs text-muted-foreground">
          Removal behavior is set to delete.{' '}
          <button
            type="button"
            className="underline hover:text-foreground transition-colors"
            onClick={() => {
              onOpenChange(false)
              useUIStore.getState().openPreferencesPane('general')
            }}
          >
            Change in Settings
          </button>
        </p>
      )}
    </ConfirmDialog>
  )
}
