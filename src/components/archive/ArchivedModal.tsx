import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Archive, Loader2, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { invoke } from '@/lib/transport'
import { isNativeApp } from '@/lib/environment'
import { useIsMobile } from '@/hooks/use-mobile'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useArchivedWorktrees, useProjects } from '@/services/projects'
import { MIN_SESSION_SEARCH_LEN, useAllArchivedSessions } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { useUIStore } from '@/store/ui-store'
import type { Backend, SessionSearchResponse } from '@/types/chat'
import {
  ToolbarContent,
  useHasWindowToolbar,
} from '@/components/toolbar/toolbar-slots'
import { ToolbarPaletteSearch } from '@/components/toolbar/ToolbarSearchField'
import {
  DEFAULT_ARCHIVED_FILTERS,
  filterArchivedItems,
  groupArchivedItems,
  toArchivedItems,
  type ArchivedFilters,
  type ArchivedItem,
  type ArchivedKindFilter,
} from './archived-items'
import { ArchivedToolbar, ArchivedSelectionBar } from './ArchivedToolbar'
import { ArchivedList } from './ArchivedList'
import {
  ArchivedDeleteDialog,
  type ArchivedDeleteTarget,
} from './ArchivedDeleteDialog'
import { useArchivedActions } from './useArchivedActions'

interface ArchivedModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The Archived view in the main area, opened from the sidebar's Archived row. */
export function ArchivedView() {
  // Like Home: the window toolbar names the view.
  const hasToolbar = useHasWindowToolbar()
  return (
    <>
      {hasToolbar && (
        <ToolbarContent
          title="Archived"
          subtitle="Worktrees and sessions you archived."
          search={<ToolbarPaletteSearch />}
        />
      )}
      <ArchivedItems variant="page" open onOpenChange={() => undefined} />
    </>
  )
}

/** The Archived dialog. The phone layout uses it; it has no main area. */
export function ArchivedModal({ open, onOpenChange }: ArchivedModalProps) {
  return (
    <ArchivedItems variant="dialog" open={open} onOpenChange={onOpenChange} />
  )
}

interface CleanupResult {
  deleted_worktrees: number
  deleted_sessions: number
  deleted_orphan_indexes?: number
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Session ids whose message text matches the query, with a snippet. Uses the
 * full-text session search; it skips queries under 3 characters.
 */
function useArchivedMessageSearch(query: string): ReadonlyMap<string, string> {
  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed, 300)
  const { data } = useQuery({
    queryKey: ['archived-message-search', debounced],
    queryFn: () =>
      invoke<SessionSearchResponse>('search_session_messages', {
        query: debounced,
        includeArchived: true,
        limit: 500,
      }),
    enabled: debounced.length >= MIN_SESSION_SEARCH_LEN,
    staleTime: 1000 * 30,
  })
  return useMemo(
    () =>
      new Map(
        // Hits for an older query would keep stale rows while typing.
        debounced === trimmed && debounced.length >= MIN_SESSION_SEARCH_LEN
          ? (data?.hits ?? []).map(hit => [hit.session_id, hit.snippet])
          : []
      ),
    [data, debounced, trimmed]
  )
}

function ArchivedItems({
  variant,
  open,
  onOpenChange,
}: ArchivedModalProps & { variant: 'dialog' | 'page' }) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const isDelete = (preferences?.removal_behavior ?? 'archive') === 'delete'
  const isMobile = useIsMobile()
  const keyboard = isNativeApp() && !isMobile

  const sort = useUIStore(state => state.archivedSort)
  const [filters, setFilters] = useState<ArchivedFilters>(
    DEFAULT_ARCHIVED_FILTERS
  )
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ArchivedDeleteTarget | null>(
    null
  )
  const [isDeletingAll, setIsDeletingAll] = useState(false)

  const { data: archivedWorktrees, isLoading: isLoadingWorktrees } =
    useArchivedWorktrees()
  const { data: archivedSessions, isLoading: isLoadingSessions } =
    useAllArchivedSessions()
  const { data: projects, isLoading: isLoadingProjects } = useProjects()
  const messageMatches = useArchivedMessageSearch(filters.query)

  const items = useMemo(
    () => toArchivedItems(archivedWorktrees, archivedSessions, projects),
    [archivedWorktrees, archivedSessions, projects]
  )
  const archivedWorktreeIds = useMemo(
    () => new Set((archivedWorktrees ?? []).map(w => w.id)),
    [archivedWorktrees]
  )

  const counts = useMemo((): Record<ArchivedKindFilter, number> => {
    const sessions = items.filter(i => i.kind === 'session').length
    return {
      all: items.length,
      session: sessions,
      worktree: items.length - sessions,
    }
  }, [items])

  const projectOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const item of items) byId.set(item.projectId, item.projectName)
    return [...byId]
      .map(([id, name]) => ({ id, name: name || 'Unknown project' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  const backendOptions = useMemo(() => {
    const set = new Set<Backend>()
    for (const item of items) {
      if (item.kind === 'session' && item.backend) set.add(item.backend)
    }
    return [...set].sort()
  }, [items])

  const visible = useMemo(
    () => filterArchivedItems(items, filters, new Set(messageMatches.keys())),
    [items, filters, messageMatches]
  )
  const groups = useMemo(
    () => groupArchivedItems(visible, sort),
    [visible, sort]
  )
  const rows = useMemo(() => groups.flatMap(g => g.items), [groups])
  const selected = useMemo(
    () => rows.filter(row => selectedKeys.has(row.key)),
    [rows, selectedKeys]
  )
  // Keep one row tabbable: the cursor, or the first row when it is gone.
  const cursorKey =
    activeKey && rows.some(r => r.key === activeKey)
      ? activeKey
      : (rows[0]?.key ?? null)

  const actions = useArchivedActions({
    archivedWorktreeIds,
    onOpened: () => onOpenChange(false),
  })
  const { restore, restoreAndOpen, deletePermanently, copyLinks } = actions

  const dropFromSelection = useCallback((done: ArchivedItem[]) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      for (const item of done) next.delete(item.key)
      return next
    })
  }, [])

  const toggleSelect = useCallback((item: ArchivedItem) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(item.key)) next.delete(item.key)
      else next.add(item.key)
      return next
    })
  }, [])

  const handleFocus = useCallback(
    (item: ArchivedItem) => setActiveKey(item.key),
    []
  )
  const handleRestore = useCallback(
    (item: ArchivedItem) => {
      void restore([item]).then(() => dropFromSelection([item]))
    },
    [restore, dropFromSelection]
  )
  const handleRestoreAndOpen = useCallback(
    (item: ArchivedItem) => void restoreAndOpen(item),
    [restoreAndOpen]
  )
  const handleCopyLink = useCallback(
    (item: ArchivedItem) => copyLinks([item]),
    [copyLinks]
  )
  /** Delete on a selected row asks about the whole selection. */
  const handleDelete = useCallback(
    (item: ArchivedItem) =>
      setDeleteTarget({
        type: 'items',
        items:
          selectedKeys.has(item.key) && selected.length > 1 ? selected : [item],
      }),
    [selectedKeys, selected]
  )

  const handleDeleteAll = useCallback(async () => {
    setIsDeletingAll(true)
    const toastId = toast.loading('Deleting all archives...')
    try {
      const result = await invoke<CleanupResult>('delete_all_archives')
      queryClient.invalidateQueries({ queryKey: ['archived-worktrees'] })
      queryClient.invalidateQueries({ queryKey: ['all-archived-sessions'] })
      const parts: string[] = []
      if (result.deleted_worktrees > 0)
        parts.push(plural(result.deleted_worktrees, 'worktree'))
      if (result.deleted_sessions > 0)
        parts.push(plural(result.deleted_sessions, 'session'))
      if ((result.deleted_orphan_indexes ?? 0) > 0)
        parts.push(
          plural(
            result.deleted_orphan_indexes ?? 0,
            'orphaned session index file'
          )
        )
      if (parts.length > 0) {
        toast.success(`Deleted ${parts.join(' and ')}`, { id: toastId })
      } else {
        toast.info('No archives to delete', { id: toastId })
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to delete archives: ${error}`, { id: toastId })
    } finally {
      setIsDeletingAll(false)
      setDeleteTarget(null)
    }
  }, [queryClient, onOpenChange])

  const confirmDelete = (target: ArchivedDeleteTarget) => {
    if (target.type === 'all') {
      void handleDeleteAll()
      return
    }
    setDeleteTarget(null)
    void deletePermanently(target.items).then(() =>
      dropFromSelection(target.items)
    )
  }

  const isLoading = isLoadingWorktrees || isLoadingProjects || isLoadingSessions
  const isEmpty = items.length === 0 && !isLoading
  const isFiltered =
    filters.query.trim() !== '' ||
    filters.kind !== 'all' ||
    filters.projectId !== '' ||
    filters.backend !== ''

  const title = (
    <>
      <Archive className="h-4 w-4" />
      Archived Items
      {!isEmpty && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteTarget({ type: 'all' })}
          disabled={isDeletingAll || actions.busy}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete All
        </Button>
      )}
    </>
  )

  const content = isLoading ? (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ) : isEmpty ? (
    <div className="py-8 text-center text-muted-foreground">
      No archived items.
      <br />
      {isDelete ? (
        <span className="text-sm">
          Removal behavior is set to delete — closed items are permanently
          removed.{' '}
          <button
            type="button"
            className="underline transition-colors hover:text-foreground"
            onClick={() => {
              onOpenChange(false)
              useUIStore.getState().openPreferencesPane('general')
            }}
          >
            Change in Settings
          </button>
        </span>
      ) : (
        <span className="text-sm">
          Archive worktrees and sessions to keep them for later without
          cluttering your workspace.
        </span>
      )}
    </div>
  ) : (
    <>
      <ArchivedToolbar
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={useUIStore.getState().setArchivedSort}
        counts={counts}
        projects={projectOptions}
        backends={backendOptions}
      />
      <ArchivedSelectionBar
        visibleCount={rows.length}
        selectedCount={selected.length}
        busy={actions.busy}
        onSelectAll={select =>
          setSelectedKeys(select ? new Set(rows.map(r => r.key)) : new Set())
        }
        onRestore={() =>
          void restore(selected).then(() => dropFromSelection(selected))
        }
        onCopyLinks={() => copyLinks(selected)}
        onDelete={() => setDeleteTarget({ type: 'items', items: selected })}
      />
      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {filters.query.trim()
            ? `No archived items match “${filters.query.trim()}”.`
            : 'No archived items match these filters.'}
          {isFiltered && (
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters(DEFAULT_ARCHIVED_FILTERS)}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      ) : (
        <ArchivedList
          groups={groups}
          rows={rows}
          selectedKeys={selectedKeys}
          activeKey={cursorKey}
          busy={actions.busy}
          snippets={messageMatches}
          keyboard={keyboard}
          onToggleSelect={toggleSelect}
          onFocus={handleFocus}
          onRestore={handleRestore}
          onRestoreAndOpen={handleRestoreAndOpen}
          onCopyLink={handleCopyLink}
          onDelete={handleDelete}
        />
      )}
    </>
  )

  return (
    <>
      {variant === 'page' ? (
        <div
          data-testid="archived-view"
          className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-3 overflow-hidden p-4 font-sans sm:p-6"
        >
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {title}
          </h1>
          {content}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none sm:!w-[90vw] sm:!max-w-[90vw] sm:!h-[85vh] sm:!max-h-[85vh] sm:!rounded-lg flex flex-col gap-3 overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                {title}
              </DialogTitle>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
      )}

      <ArchivedDeleteDialog
        target={deleteTarget}
        busy={isDeletingAll}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </>
  )
}

export default ArchivedModal
