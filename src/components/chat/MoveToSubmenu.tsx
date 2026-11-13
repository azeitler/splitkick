import { FolderInput, FolderOpen, GitBranch } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import { moveSessionWithToast } from '@/lib/session-move-toast'
import { useWorktree, useWorktrees } from '@/services/projects'
import { useUIStore } from '@/store/ui-store'
import type { Worktree } from '@/types/projects'

/** Worktrees a session can move to: not its own, not archived, ready. */
export function moveTargetsInProject(
  worktrees: Worktree[],
  currentWorktreeId: string
): Worktree[] {
  return worktrees.filter(
    worktree =>
      worktree.id !== currentWorktreeId &&
      !worktree.archived_at &&
      worktree.status !== 'pending' &&
      worktree.status !== 'deleting'
  )
}

/**
 * "Move to" in the session menu: "Other Project…" opens the Move Session
 * dialog; below it, the other worktrees of this project move the session in
 * one click (issue #67).
 */
export function MoveToSubmenu({
  sessionId,
  worktreeId,
  projectId,
  disabled,
}: {
  sessionId: string
  worktreeId: string
  /** The session's project; read from its worktree when not given. */
  projectId?: string
  disabled: boolean
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <FolderInput className="mr-2 h-4 w-4" />
        Move to
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        {/* Radix mounts the content only while the submenu is open, so the
            worktree list loads only then. */}
        <MoveTargets
          sessionId={sessionId}
          worktreeId={worktreeId}
          projectId={projectId}
        />
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

function MoveTargets({
  sessionId,
  worktreeId,
  projectId,
}: {
  sessionId: string
  worktreeId: string
  projectId?: string
}) {
  const { data: worktree } = useWorktree(projectId ? null : worktreeId)
  const resolvedProjectId = projectId ?? worktree?.project_id ?? null
  const { data: worktrees, isLoading } = useWorktrees(resolvedProjectId)
  const targets = moveTargetsInProject(worktrees ?? [], worktreeId)

  return (
    <>
      <ContextMenuItem
        onSelect={() => {
          useUIStore.getState().setMoveSessionTarget({ worktreeId, sessionId })
        }}
      >
        <FolderOpen className="mr-2 h-4 w-4" />
        Other Project…
      </ContextMenuItem>
      <ContextMenuSeparator />
      {targets.length === 0 ? (
        <ContextMenuItem disabled>
          {isLoading ? 'Loading worktrees…' : 'No other worktree here'}
        </ContextMenuItem>
      ) : (
        targets.map(target => (
          <ContextMenuItem
            key={target.id}
            title={target.branch}
            onSelect={() => {
              moveSessionWithToast(sessionId, target.id, target.name)
            }}
          >
            <GitBranch className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">{target.name}</span>
          </ContextMenuItem>
        ))
      )}
    </>
  )
}
