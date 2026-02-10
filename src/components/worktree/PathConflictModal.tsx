import { useCallback } from 'react'
import { Archive, FolderPlus, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/store/ui-store'
import {
  useUnarchiveWorktree,
  useImportWorktree,
  useCreateWorktree,
} from '@/services/projects'

export function PathConflictModal() {
  const pathConflictData = useUIStore(state => state.pathConflictData)
  const closePathConflictModal = useUIStore(
    state => state.closePathConflictModal
  )

  const unarchiveWorktree = useUnarchiveWorktree()
  const importWorktree = useImportWorktree()
  const createWorktree = useCreateWorktree()

  const isOpen = pathConflictData !== null
  const hasArchivedWorktree = !!pathConflictData?.archivedWorktreeId

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closePathConflictModal()
      }
    },
    [closePathConflictModal]
  )

  const handleRestore = useCallback(() => {
    if (!pathConflictData?.archivedWorktreeId) return

    unarchiveWorktree.mutate(pathConflictData.archivedWorktreeId)
    closePathConflictModal()
  }, [pathConflictData, unarchiveWorktree, closePathConflictModal])

  const handleImport = useCallback(() => {
    if (!pathConflictData) return

    importWorktree.mutate({
      projectId: pathConflictData.projectId,
      path: pathConflictData.path,
    })
    closePathConflictModal()
  }, [pathConflictData, importWorktree, closePathConflictModal])

  const handleCreateNew = useCallback(() => {
    if (!pathConflictData) return

    // Create a new worktree with the suggested name and issue context
    createWorktree.mutate({
      projectId: pathConflictData.projectId,
      customName: pathConflictData.suggestedName,
      issueContext: pathConflictData.issueContext,
    })
    closePathConflictModal()
  }, [pathConflictData, createWorktree, closePathConflictModal])

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Directory Already Exists</DialogTitle>
          <DialogDescription>
            {hasArchivedWorktree ? (
              <>
                This path matches an archived worktree{' '}
                <span className="font-semibold text-foreground">
                  {pathConflictData?.archivedWorktreeName}
                </span>
                . What would you like to do?
              </>
            ) : (
              <>
                A directory already exists at this path. What would you like to
                do?
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-muted px-3 py-2.5 text-sm font-mono text-muted-foreground break-all">
          {pathConflictData?.path}
        </div>

        <div className="flex flex-col gap-2">
          {hasArchivedWorktree && (
            <Button
              onClick={handleRestore}
              className="w-full justify-start h-11"
              variant="default"
            >
              <Archive className="mr-3 h-4 w-4" />
              Restore from Archive
            </Button>
          )}

          {!hasArchivedWorktree && (
            <Button
              onClick={handleImport}
              className="w-full justify-start h-11"
              variant="default"
            >
              <FolderPlus className="mr-3 h-4 w-4" />
              Import Existing Directory
            </Button>
          )}

          <Button
            onClick={handleCreateNew}
            className="w-full justify-between h-11"
            variant="outline"
          >
            <span className="flex items-center">
              <Plus className="mr-3 h-4 w-4" />
              Create New Worktree
            </span>
            {pathConflictData?.suggestedName && (
              <span className="text-sm text-muted-foreground font-mono">
                {pathConflictData.suggestedName}
              </span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default PathConflictModal
