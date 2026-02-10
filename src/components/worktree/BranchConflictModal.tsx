import { useCallback } from 'react'
import { GitBranch, Plus } from 'lucide-react'
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
  useCreateWorktree,
  useCreateWorktreeFromExistingBranch,
} from '@/services/projects'

export function BranchConflictModal() {
  const branchConflictData = useUIStore(state => state.branchConflictData)
  const closeBranchConflictModal = useUIStore(
    state => state.closeBranchConflictModal
  )

  const createWorktree = useCreateWorktree()
  const createWorktreeFromExistingBranch = useCreateWorktreeFromExistingBranch()

  const isOpen = branchConflictData !== null

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeBranchConflictModal()
      }
    },
    [closeBranchConflictModal]
  )

  const handleUseExisting = useCallback(() => {
    if (!branchConflictData) return

    // Create a worktree using the existing branch
    createWorktreeFromExistingBranch.mutate({
      projectId: branchConflictData.projectId,
      branchName: branchConflictData.branch,
      issueContext: branchConflictData.issueContext,
      prContext: branchConflictData.prContext,
    })
    closeBranchConflictModal()
  }, [
    branchConflictData,
    createWorktreeFromExistingBranch,
    closeBranchConflictModal,
  ])

  const handleCreateNew = useCallback(() => {
    if (!branchConflictData) return

    // Create a new worktree with the suggested name and issue/PR context
    createWorktree.mutate({
      projectId: branchConflictData.projectId,
      customName: branchConflictData.suggestedName,
      issueContext: branchConflictData.issueContext,
      prContext: branchConflictData.prContext,
    })
    closeBranchConflictModal()
  }, [branchConflictData, createWorktree, closeBranchConflictModal])

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Branch Already Exists</DialogTitle>
          <DialogDescription>
            A branch with this name already exists in the repository. Would you
            like to use the existing branch or create a new one?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-muted px-3 py-2.5 text-sm font-mono text-muted-foreground flex items-center gap-2">
          <GitBranch className="h-4 w-4 shrink-0" />
          {branchConflictData?.branch}
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={handleUseExisting}
            className="w-full justify-start h-11"
            variant="default"
          >
            <GitBranch className="mr-3 h-4 w-4" />
            Use Existing Branch
          </Button>
          <Button
            onClick={handleCreateNew}
            className="w-full justify-between h-11"
            variant="outline"
          >
            <span className="flex items-center">
              <Plus className="mr-3 h-4 w-4" />
              Create with New Name
            </span>
            {branchConflictData?.suggestedName && (
              <span className="text-sm opacity-80 font-mono">
                {branchConflictData.suggestedName}
              </span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default BranchConflictModal
