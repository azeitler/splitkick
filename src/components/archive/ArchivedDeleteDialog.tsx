import { Loader2, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { ArchivedItem } from './archived-items'

/** What the confirmation is about: some rows, or every archive. */
export type ArchivedDeleteTarget =
  | { type: 'items'; items: ArchivedItem[] }
  | { type: 'all' }

function describe(target: ArchivedDeleteTarget): {
  title: string
  body: string
  action: string
} {
  if (target.type === 'all') {
    return {
      title: 'Delete all archives?',
      body: 'This permanently deletes all archived worktrees and sessions, including their git branches and worktree folders. This cannot be undone.',
      action: 'Delete all',
    }
  }
  const [first] = target.items
  if (target.items.length === 1 && first) {
    return first.kind === 'worktree'
      ? {
          title: 'Permanently delete worktree?',
          body: `This permanently deletes the worktree “${first.name}” and its git branch. This cannot be undone.`,
          action: 'Delete forever',
        }
      : {
          title: 'Permanently delete session?',
          body: `This permanently deletes the session “${first.name}” and all its messages. This cannot be undone.`,
          action: 'Delete forever',
        }
  }
  const worktrees = target.items.filter(i => i.kind === 'worktree').length
  const sessions = target.items.length - worktrees
  const parts = [
    worktrees &&
      `${worktrees} worktree${worktrees === 1 ? '' : 's'} (and their git branches)`,
    sessions && `${sessions} session${sessions === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return {
    title: `Permanently delete ${target.items.length} items?`,
    body: `This permanently deletes ${parts.join(' and ')}. This cannot be undone.`,
    action: `Delete ${target.items.length} items`,
  }
}

export function ArchivedDeleteDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: ArchivedDeleteTarget | null
  busy: boolean
  onCancel: () => void
  onConfirm: (target: ArchivedDeleteTarget) => void
}) {
  const text = target ? describe(target) : null
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={open => !open && !busy && onCancel()}
      title={text?.title}
      description={text?.body}
      confirmLabel={
        <>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          {text?.action}
        </>
      }
      confirmDisabled={busy}
      onConfirm={() => target && onConfirm(target)}
    />
  )
}
