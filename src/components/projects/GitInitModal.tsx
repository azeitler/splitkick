import { PRODUCT_NAME } from '@/lib/build-info'
import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@/lib/transport'
import {
  Loader2,
  GitBranch,
  FolderOpen,
  AlertCircle,
  AlertTriangle,
  Folder,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useProjectsStore } from '@/store/projects-store'
import {
  useInitGitInFolder,
  useAddProject,
  useGitInitPreview,
  useSetProjectIsGit,
} from '@/services/projects'
import { getFilename } from '@/lib/path-utils'
import type { GitInitPreview } from '@/types/projects'
import { cn } from '@/lib/utils'

interface GitIdentity {
  name: string | null
  email: string | null
}

type FolderChoice = 'plain' | 'git'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** "12 files (3.4 MB)" — what the first commit would add */
export function describeCommitSize(preview: GitInitPreview): string {
  const count = preview.truncated
    ? `more than ${preview.file_count.toLocaleString()}`
    : preview.file_count.toLocaleString()
  const noun = preview.file_count === 1 && !preview.truncated ? 'file' : 'files'
  return `${count} ${noun} (${formatSize(preview.total_bytes)})`
}

/**
 * Shown when the user adds a folder without git (#93): add it as a plain
 * project, or initialize git with a .gitignore and an optional first commit.
 */

export function GitInitModal() {
  const {
    gitInitModalOpen,
    gitInitModalPath,
    gitInitModalChoice,
    gitInitModalProjectId,
    closeGitInitModal,
    setAddProjectDialogOpen,
    addProjectParentFolderId,
  } = useProjectsStore()

  const initGit = useInitGitInFolder()
  const addProject = useAddProject()
  const setProjectIsGit = useSetProjectIsGit()
  // An existing plain project: init, then switch it (no "Add without git").
  const switchingProject = gitInitModalProjectId !== null
  const preview = useGitInitPreview(gitInitModalOpen ? gitInitModalPath : null)

  const [choice, setChoice] = useState<FolderChoice>('plain')
  const [commitAll, setCommitAll] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [identityChecked, setIdentityChecked] = useState(false)
  const [needsIdentity, setNeedsIdentity] = useState(false)
  const [gitName, setGitName] = useState('')
  const [gitEmail, setGitEmail] = useState('')
  const [savingIdentity, setSavingIdentity] = useState(false)

  const folderName = gitInitModalPath ? getFilename(gitInitModalPath) : ''

  // Check git identity when modal opens
  useEffect(() => {
    if (!gitInitModalOpen) {
      // Reset state when modal closes
      setIdentityChecked(false)
      setNeedsIdentity(false)
      setGitName('')
      setGitEmail('')
      setError(null)
      setCommitAll(true)
      return
    }
    setChoice(gitInitModalChoice)

    invoke<GitIdentity>('check_git_identity')
      .then(identity => {
        const missing = !identity.name || !identity.email
        setNeedsIdentity(missing)
        if (identity.name) setGitName(identity.name)
        if (identity.email) setGitEmail(identity.email)
        setIdentityChecked(true)
      })
      .catch(() => {
        // If check fails, assume identity is needed
        setNeedsIdentity(true)
        setIdentityChecked(true)
      })
  }, [gitInitModalOpen, gitInitModalChoice])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setError(null)
        closeGitInitModal()
      }
    },
    [closeGitInitModal]
  )

  const handleAddPlain = useCallback(async () => {
    if (!gitInitModalPath) return
    setError(null)
    try {
      await addProject.mutateAsync({
        path: gitInitModalPath,
        parentId: addProjectParentFolderId ?? undefined,
        plain: true,
      })
      closeGitInitModal()
      setAddProjectDialogOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [
    gitInitModalPath,
    addProject,
    addProjectParentFolderId,
    closeGitInitModal,
    setAddProjectDialogOpen,
  ])

  const handleInitialize = useCallback(async () => {
    if (!gitInitModalPath) return

    setError(null)

    try {
      // Step 0: Set git identity if needed
      if (needsIdentity) {
        if (!gitName.trim() || !gitEmail.trim()) {
          setError('Please enter your name and email for git commits.')
          return
        }
        setSavingIdentity(true)
        try {
          await invoke('set_git_identity', {
            name: gitName.trim(),
            email: gitEmail.trim(),
          })
        } finally {
          setSavingIdentity(false)
        }
      }

      // Step 1: Initialize git
      await initGit.mutateAsync({ path: gitInitModalPath, commitAll })

      // Step 2: Switch the plain project, or add as project (with parent
      // folder if adding into a folder)
      if (gitInitModalProjectId) {
        await setProjectIsGit.mutateAsync({
          projectId: gitInitModalProjectId,
          isGit: true,
        })
      } else {
        await addProject.mutateAsync({
          path: gitInitModalPath,
          parentId: addProjectParentFolderId ?? undefined,
        })
      }

      // Close both dialogs on success
      closeGitInitModal()
      setAddProjectDialogOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    }
  }, [
    gitInitModalPath,
    needsIdentity,
    gitName,
    gitEmail,
    commitAll,
    initGit,
    addProject,
    setProjectIsGit,
    gitInitModalProjectId,
    addProjectParentFolderId,
    closeGitInitModal,
    setAddProjectDialogOpen,
  ])

  const isPending =
    savingIdentity ||
    initGit.isPending ||
    addProject.isPending ||
    setProjectIsGit.isPending

  const syncProvider = preview.data?.sync_provider ?? null
  const identityMissing =
    identityChecked && needsIdentity && (!gitName.trim() || !gitEmail.trim())

  return (
    <Dialog open={gitInitModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            {switchingProject ? 'Initialize Git' : 'This folder has no git'}
          </DialogTitle>
          <DialogDescription>
            {switchingProject
              ? 'Make this plain project a git repository.'
              : 'Add it as a plain project, or make it a git repository.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Folder path display */}
          <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
            <FolderOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{folderName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {gitInitModalPath}
              </p>
            </div>
          </div>

          {/* The two choices */}
          {!switchingProject && (
            <div
              role="radiogroup"
              aria-label="How to add this folder"
              className="grid gap-2 sm:grid-cols-2"
            >
              <ChoiceCard
                selected={choice === 'plain'}
                onSelect={() => setChoice('plain')}
                disabled={isPending}
                icon={<Folder className="h-4 w-4" />}
                title="Add without git"
                description="A plain project: chat in the folder, no worktrees, diffs or commits. Good for documents, notes and shared folders."
              />
              <ChoiceCard
                selected={choice === 'git'}
                onSelect={() => setChoice('git')}
                disabled={isPending}
                icon={<GitBranch className="h-4 w-4" />}
                title="Initialize Git"
                description="Make the folder a git repository for worktrees, diffs, commits and pull requests."
              />
            </div>
          )}

          {syncProvider && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="space-y-1">
                <p className="font-medium">This folder is in {syncProvider}</p>
                <p className="text-xs text-muted-foreground">
                  {syncProvider} syncs the files inside .git one by one. With
                  two computers this can corrupt the repository. Use a plain
                  project here, or move the folder out of {syncProvider} before
                  you initialize git.
                </p>
              </div>
            </div>
          )}

          {choice === 'git' && (
            <>
              {/* Git identity fields - shown when not configured */}
              {identityChecked && needsIdentity && (
                <div className="space-y-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    Git identity not configured
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Git requires a name and email for commits. This will be
                    saved globally.
                  </p>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="git-name" className="text-xs">
                        Name
                      </Label>
                      <Input
                        id="git-name"
                        placeholder="Your Name"
                        value={gitName}
                        onChange={e => setGitName(e.target.value)}
                        disabled={isPending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="git-email" className="text-xs">
                        Email
                      </Label>
                      <Input
                        id="git-email"
                        type="email"
                        placeholder="you@example.com"
                        value={gitEmail}
                        onChange={e => setGitEmail(e.target.value)}
                        disabled={isPending}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Description of what will happen */}
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{PRODUCT_NAME} will:</p>
                <ul className="ml-2 list-inside list-disc space-y-1">
                  <li>
                    Run <code className="rounded bg-muted px-1">git init</code>
                  </li>
                  <li>
                    {preview.data?.has_gitignore ? (
                      <>
                        Keep the existing{' '}
                        <code className="rounded bg-muted px-1">
                          .gitignore
                        </code>
                      </>
                    ) : (
                      <>
                        Write a{' '}
                        <code className="rounded bg-muted px-1">
                          .gitignore
                        </code>{' '}
                        for OS junk and temp files, with a section for large
                        binaries you can turn on
                      </>
                    )}
                  </li>
                  <li>
                    {commitAll
                      ? 'Create an initial commit with all files'
                      : 'Create an empty initial commit'}
                  </li>
                </ul>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="git-commit-all"
                  checked={commitAll}
                  onCheckedChange={checked => setCommitAll(checked === true)}
                  disabled={isPending}
                />
                <div className="grid gap-0.5">
                  <Label htmlFor="git-commit-all" className="text-sm">
                    Commit all files now
                  </Label>
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="git-init-file-summary"
                  >
                    {preview.data
                      ? describeCommitSize(preview.data)
                      : preview.isLoading
                        ? 'Counting files...'
                        : 'File count unavailable'}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-destructive">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="text-sm">{error}</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          {choice === 'plain' ? (
            <Button onClick={handleAddPlain} disabled={isPending}>
              {addProject.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {addProject.isPending ? 'Adding project...' : 'Add without git'}
            </Button>
          ) : (
            <Button
              onClick={handleInitialize}
              disabled={isPending || identityMissing}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {savingIdentity
                ? 'Setting identity...'
                : initGit.isPending
                  ? 'Initializing...'
                  : addProject.isPending
                    ? 'Adding project...'
                    : 'Initialize Git'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChoiceCard({
  selected,
  onSelect,
  disabled,
  icon,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  disabled: boolean
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'hover:bg-muted/60'
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  )
}

export default GitInitModal
