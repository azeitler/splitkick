import { useCallback, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isBaseSession, type Worktree } from '@/types/projects'
import type { WorktreeSessions } from '@/types/chat'
import { invoke } from '@/lib/transport'
import { chatQueryKeys } from '@/services/chat'
import { isTauri, useReorderWorktrees } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import {
  compareWorktreesForCanvasSort,
  getWorktreeLastActivity,
} from './worktree-sort-utils'
import { WorktreeItem } from './WorktreeItem'
import { WorktreeItemSkeleton } from './WorktreeItemSkeleton'

interface SortableWorktreeProps {
  worktree: Worktree
  projectId: string
  projectPath: string
  defaultBranch: string
  disabled: boolean
}

function SortableWorktree({
  worktree,
  projectId,
  projectPath,
  defaultBranch,
  disabled,
}: SortableWorktreeProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: worktree.id,
    disabled,
  })

  const style: React.CSSProperties = {
    // Use Translate instead of Transform to avoid scale which affects text rendering
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
  }

  // Pending or deleting worktrees show skeleton
  if (worktree.status === 'pending' || worktree.status === 'deleting') {
    return <WorktreeItemSkeleton worktree={worktree} />
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={disabled ? '' : isDragging ? 'cursor-grabbing' : 'cursor-grab'}
    >
      <WorktreeItem
        worktree={worktree}
        projectId={projectId}
        projectPath={projectPath}
        defaultBranch={defaultBranch}
      />
    </div>
  )
}

interface WorktreeListProps {
  projectId: string
  projectPath: string
  worktrees: Worktree[]
  defaultBranch: string
}

export function WorktreeList({
  projectId,
  projectPath,
  worktrees,
  defaultBranch,
}: WorktreeListProps) {
  const reorderWorktrees = useReorderWorktrees()
  const worktreeSortMode = useProjectsStore(
    state =>
      state.projectCanvasSettings[projectId]?.worktreeSortMode ?? 'created'
  )

  const pendingWorktrees = useMemo(
    () => worktrees.filter(w => w.status === 'pending'),
    [worktrees]
  )
  const readyWorktrees = useMemo(
    () =>
      worktrees.filter(
        w => !w.status || w.status === 'ready' || w.status === 'error'
      ),
    [worktrees]
  )

  const sessionQueries = useQueries({
    queries: readyWorktrees.map(wt => ({
      queryKey: [...chatQueryKeys.sessions(wt.id), 'with-counts'],
      queryFn: async (): Promise<WorktreeSessions> => {
        if (!isTauri() || !wt.id || !wt.path) {
          return {
            worktree_id: wt.id,
            sessions: [],
            active_session_id: null,
            version: 2,
          }
        }
        return invoke<WorktreeSessions>('get_sessions', {
          worktreeId: wt.id,
          worktreePath: wt.path,
          includeMessageCounts: true,
        })
      },
      enabled: !!wt.id && !!wt.path,
    })),
  })

  const sessionsFingerprint = sessionQueries
    .map(q => `${q.data?.worktree_id}:${q.dataUpdatedAt}:${q.isLoading}`)
    .join('|')

  const sessionsByWorktreeId = useMemo(() => {
    const map = new Map<string, WorktreeSessions>()
    for (const query of sessionQueries) {
      if (query.data?.worktree_id) {
        map.set(query.data.worktree_id, query.data)
      }
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsFingerprint])

  // Match ProjectCanvasView ordering: pending first, then base session first,
  // then selected canvas sort mode using session last activity when requested.
  const sortedWorktrees = useMemo(() => {
    const latestActivityByWorktreeId = new Map<string, number>()
    for (const worktree of pendingWorktrees) {
      latestActivityByWorktreeId.set(worktree.id, worktree.created_at)
    }
    for (const worktree of readyWorktrees) {
      const sessions = sessionsByWorktreeId.get(worktree.id)?.sessions ?? []
      latestActivityByWorktreeId.set(
        worktree.id,
        getWorktreeLastActivity(sessions, worktree.created_at)
      )
    }

    const sortedPending = [...pendingWorktrees].sort(
      (a, b) => b.created_at - a.created_at
    )
    const sortedReady = [...readyWorktrees].sort((a, b) =>
      compareWorktreesForCanvasSort(
        a,
        b,
        latestActivityByWorktreeId,
        worktreeSortMode
      )
    )

    return [...sortedPending, ...sortedReady]
  }, [pendingWorktrees, readyWorktrees, sessionsByWorktreeId, worktreeSortMode])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const canReorderWorktree = useCallback((worktree: Worktree) => {
    return (
      !isBaseSession(worktree) &&
      (!worktree.status ||
        worktree.status === 'ready' ||
        worktree.status === 'error')
    )
  }, [])

  const sortableIds = useMemo(
    () => sortedWorktrees.map(worktree => worktree.id),
    [sortedWorktrees]
  )

  const worktreeById = useMemo(
    () => new Map(sortedWorktrees.map(worktree => [worktree.id, worktree])),
    [sortedWorktrees]
  )

  const draggableIds = useMemo(
    () =>
      sortedWorktrees
        .filter(worktree => canReorderWorktree(worktree))
        .map(worktree => worktree.id),
    [canReorderWorktree, sortedWorktrees]
  )

  const draggableIdSet = useMemo(() => new Set(draggableIds), [draggableIds])

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return

      const activeId = String(active.id)
      const overId = String(over.id)
      const oldIndex = draggableIds.indexOf(activeId)
      const newIndex = draggableIds.indexOf(overId)

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

      const reorderedDraggableIds = arrayMove(draggableIds, oldIndex, newIndex)
      const nextDraggableIds = [...reorderedDraggableIds]
      const fullOrderedIds = sortedWorktrees.map(worktree => {
        if (!draggableIdSet.has(worktree.id)) return worktree.id
        return nextDraggableIds.shift() ?? worktree.id
      })

      useProjectsStore
        .getState()
        .setProjectCanvasWorktreeSortMode(projectId, 'manual')

      reorderWorktrees.mutate({
        projectId,
        worktreeIds: fullOrderedIds.filter(id => {
          const worktree = worktreeById.get(id)
          return (
            worktree != null &&
            (isBaseSession(worktree) || canReorderWorktree(worktree))
          )
        }),
      })
    },
    [
      canReorderWorktree,
      draggableIdSet,
      draggableIds,
      projectId,
      reorderWorktrees,
      sortedWorktrees,
      worktreeById,
    ]
  )

  return (
    <div
      className="ml-4 border-l border-border/40 py-0.5"
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortableIds}
          strategy={verticalListSortingStrategy}
        >
          {sortedWorktrees.map(worktree => {
            return (
              <SortableWorktree
                key={worktree.id}
                worktree={worktree}
                projectId={projectId}
                projectPath={projectPath}
                defaultBranch={defaultBranch}
                disabled={
                  reorderWorktrees.isPending || !canReorderWorktree(worktree)
                }
              />
            )
          })}
        </SortableContext>
      </DndContext>
    </div>
  )
}
