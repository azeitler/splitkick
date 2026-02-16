import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { usePreferences } from '@/services/preferences'
import { useUIStore } from '@/store/ui-store'

interface CloseWorktreeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  branchName?: string
}

export function CloseWorktreeDialog({
  open,
  onOpenChange,
  onConfirm,
  branchName,
}: CloseWorktreeDialogProps) {
  const { data: preferences } = usePreferences()
  const isDelete = (preferences?.removal_behavior ?? 'delete') === 'delete'

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isDelete ? 'Delete worktree?' : 'Archive & close worktree?'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {branchName
                  ? `This will ${isDelete ? 'permanently delete' : 'archive and close'} the "${branchName}" worktree and all its sessions.`
                  : `This will ${isDelete ? 'permanently delete' : 'archive and close'} the worktree and all its sessions.`}
              </p>
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
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            autoFocus
            onClick={onConfirm}
            className={isDelete ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {isDelete ? 'Delete' : 'Archive & Close'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
