import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { copyToClipboard } from '@/lib/clipboard'
import { navigateToRestoredItem } from '@/lib/restore-navigation'
import { splitkickMarkdownLink } from '@/lib/splitkick-links'
import { chatQueryKeys } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import type { Worktree } from '@/types/projects'
import type { ArchivedItem } from './archived-items'

/** Worktrees before sessions, so a session finds its worktree restored. */
const worktreesFirst = (items: ArchivedItem[]) => [
  ...items.filter(i => i.kind === 'worktree'),
  ...items.filter(i => i.kind === 'session'),
]

/** Sessions before worktrees: deleting a worktree removes its sessions. */
const sessionsFirst = (items: ArchivedItem[]) => [
  ...items.filter(i => i.kind === 'session'),
  ...items.filter(i => i.kind === 'worktree'),
]

function countLabel(items: ArchivedItem[]): string {
  if (items.length === 1) return `“${items[0]?.name}”`
  return `${items.length} items`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Restore, delete and copy archived rows. One code path serves one row and a
 * multi-selection, so a bulk action shows one summary toast, not one per row.
 */
export function useArchivedActions({
  archivedWorktreeIds,
  onOpened,
}: {
  /** Ids of the archived worktrees, to restore a session's worktree first */
  archivedWorktreeIds: ReadonlySet<string>
  /** Called after "Restore and open" navigated away (closes the dialog) */
  onOpened: () => void
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(
    (items: ArchivedItem[]) => {
      queryClient.invalidateQueries({ queryKey: ['archived-worktrees'] })
      queryClient.invalidateQueries({ queryKey: ['all-archived-sessions'] })
      queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
      for (const item of items) {
        const worktreeId =
          item.kind === 'session' ? item.entry.worktree_id : item.id
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })
        queryClient.invalidateQueries({
          queryKey: projectsQueryKeys.worktrees(item.projectId),
        })
      }
    },
    [queryClient]
  )

  /** Restore one row. Returns the worktree (and session) to navigate to. */
  const restoreOne = useCallback(
    async (
      item: ArchivedItem,
      restoredWorktreeIds: Set<string>
    ): Promise<{ worktree: Worktree; sessionId?: string }> => {
      if (item.kind === 'worktree') {
        const worktree = await invoke<Worktree>('unarchive_worktree', {
          worktreeId: item.id,
        })
        restoredWorktreeIds.add(item.id)
        return { worktree }
      }
      const { entry } = item
      if (
        archivedWorktreeIds.has(entry.worktree_id) &&
        !restoredWorktreeIds.has(entry.worktree_id)
      ) {
        await invoke<Worktree>('unarchive_worktree', {
          worktreeId: entry.worktree_id,
        })
        restoredWorktreeIds.add(entry.worktree_id)
      }
      // Handles a normal restore and a closed base session alike.
      const response = await invoke<{ worktree: Worktree }>(
        'restore_session_with_base',
        {
          worktreeId: entry.worktree_id,
          worktreePath: entry.worktree_path,
          sessionId: entry.session.id,
          projectId: entry.project_id,
        }
      )
      return { worktree: response.worktree, sessionId: entry.session.id }
    },
    [archivedWorktreeIds]
  )

  /** Run `action` on each row in turn; one toast for the whole batch. */
  const runBatch = useCallback(
    async <T>(
      items: ArchivedItem[],
      verb: { loading: string; done: string; failed: string },
      action: (item: ArchivedItem) => Promise<T>
    ): Promise<T[]> => {
      if (items.length === 0) return []
      setBusy(true)
      const toastId = toast.loading(`${verb.loading} ${countLabel(items)}…`)
      const results: T[] = []
      const failures: string[] = []
      for (const item of items) {
        try {
          results.push(await action(item))
        } catch (error) {
          logger.error(`${verb.failed} archived ${item.kind}`, { error })
          failures.push(`${item.name}: ${errorText(error)}`)
        }
      }
      refresh(items)
      setBusy(false)
      if (failures.length === 0) {
        toast.success(`${verb.done} ${countLabel(items)}`, { id: toastId })
      } else {
        toast.error(
          `${verb.failed} ${failures.length} of ${items.length} item${items.length === 1 ? '' : 's'}`,
          { id: toastId, description: failures.slice(0, 3).join('\n') }
        )
      }
      return results
    },
    [refresh]
  )

  const restore = useCallback(
    (items: ArchivedItem[]) => {
      const restored = new Set<string>()
      return runBatch(
        worktreesFirst(items),
        { loading: 'Restoring', done: 'Restored', failed: 'Could not restore' },
        item => restoreOne(item, restored)
      )
    },
    [runBatch, restoreOne]
  )

  const restoreAndOpen = useCallback(
    async (item: ArchivedItem) => {
      const [result] = await restore([item])
      if (!result) return
      navigateToRestoredItem(
        result.worktree.id,
        result.worktree.path,
        result.sessionId
      )
      onOpened()
    },
    [restore, onOpened]
  )

  const deletePermanently = useCallback(
    (items: ArchivedItem[]) =>
      runBatch(
        sessionsFirst(items),
        { loading: 'Deleting', done: 'Deleted', failed: 'Could not delete' },
        async item => {
          if (item.kind === 'worktree') {
            await invoke('permanently_delete_worktree', { worktreeId: item.id })
            // Close a chat on it and drop it from the launch-restore maps.
            useChatStore.getState().forgetWorktree(item.id)
            return
          }
          await invoke('delete_archived_session', {
            worktreeId: item.entry.worktree_id,
            worktreePath: item.entry.worktree_path,
            sessionId: item.id,
          })
        }
      ),
    [runBatch]
  )

  /** Copy markdown Splitkick links, one per line. */
  const copyLinks = useCallback((items: ArchivedItem[]) => {
    const text = items
      .map(item => splitkickMarkdownLink(item.kind, item.id, item.name))
      .join('\n')
    void copyToClipboard(text)
      .then(() =>
        toast.success(items.length === 1 ? 'Link copied' : 'Links copied')
      )
      .catch(() => toast.error('Failed to copy link'))
  }, [])

  return { busy, restore, restoreAndOpen, deletePermanently, copyLinks }
}
