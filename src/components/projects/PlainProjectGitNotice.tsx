import { GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSetProjectIsGit } from '@/services/projects'
import { isPlainProject, type Project } from '@/types/projects'

/**
 * Offer to switch a plain project to git when its folder has a `.git` now
 * (#93). The backend detects `.git` on every load (`git_detected`).
 */
export function PlainProjectGitNotice({ project }: { project: Project }) {
  const setIsGit = useSetProjectIsGit()
  if (!isPlainProject(project) || !project.git_detected) return null

  return (
    <div
      role="status"
      className="mx-1 mb-2 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
    >
      <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1">
        This folder is a git repository now. Switch the project to git to use
        worktrees, diffs and commits.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={setIsGit.isPending}
        onClick={() => setIsGit.mutate({ projectId: project.id, isGit: true })}
      >
        Switch to git project
      </Button>
    </div>
  )
}
