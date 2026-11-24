import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  attachInstruction,
  extractInstruction,
  type Instruction,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item'
import { isFolder, type Project } from '@/types/projects'
import { ProjectTreeItem } from './ProjectTreeItem'
import { FolderTreeItem } from './FolderTreeItem'
import { useReorderItems, useMoveItem } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { cn } from '@/lib/utils'
import {
  isProjectTreeDragData,
  isProjectTreeDropTargetData,
  ROOT_DROP_TARGET_ID,
} from '@/lib/drag-and-drop/types'
import { announceDrag } from '@/lib/drag-and-drop/live-region'
import { DropIndicator } from '@/components/drag-and-drop/DropIndicator'
import {
  canMoveIntoFolder,
  getSortedSiblings,
  instructionAtRatio,
  resolveTreeDrop,
  treeRowOperations,
} from './project-tree-drop'

interface ProjectTreeProps {
  projects: Project[]
}

/** Whether an item has its children on screen: an open folder or project
 *  with at least one child row. */
function isOpenWithChildren(
  item: Project,
  projects: Project[],
  expandedFolderIds: Set<string>
): boolean {
  return (
    isFolder(item) &&
    expandedFolderIds.has(item.id) &&
    projects.some(p => p.parent_id === item.id)
  )
}

function instructionToInsertBeforeId(
  targetId: string,
  instruction: Instruction | null
): string | null {
  if (!instruction || instruction.blocked) return null
  if (instruction.operation === 'reorder-before') return targetId
  if (instruction.operation === 'reorder-after') return `after:${targetId}`
  return null
}

interface SortableItemProps {
  item: Project
  allProjects: Project[]
  depth: number
  isOverFolder: boolean
  expandedFolderIds: Set<string>
  overFolderId: string | null
  insertBeforeId: string | null
  activeId: string | null
}

function SortableItem({
  item,
  allProjects,
  depth,
  isOverFolder,
  expandedFolderIds,
  overFolderId,
  insertBeforeId,
  activeId,
}: SortableItemProps) {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const dragHandleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    // A folder answers drops on its own row only. Its wrapper also holds the
    // child rows, and over them the folder must not compete with the child:
    // a drag that starts on the first child would read as "before the
    // folder" and move the child out of it.
    const dropElement = isFolder(item)
      ? (dragHandleRef.current ?? element)
      : element

    return combine(
      draggable({
        element,
        dragHandle: dragHandleRef.current ?? undefined,
        getInitialData: () => ({
          type: 'project-tree-item',
          itemId: item.id,
        }),
      }),
      dropTargetForElements({
        element: dropElement,
        canDrop: ({ source }) =>
          isProjectTreeDragData(source.data) && source.data.itemId !== item.id,
        getData: ({ input, element, source }) => {
          const sourceId = isProjectTreeDragData(source.data)
            ? source.data.itemId
            : null
          const canCombine =
            sourceId != null &&
            isFolder(item) &&
            canMoveIntoFolder({
              projects: allProjects,
              activeId: sourceId,
              folderId: item.id,
            })
          const openWithChildren = isOpenWithChildren(
            item,
            allProjects,
            useProjectsStore.getState().expandedFolderIds
          )

          return attachInstruction(
            {
              type: 'project-tree-item',
              targetId: item.id,
            },
            {
              input,
              element,
              axis: 'vertical',
              operations: treeRowOperations({ canCombine, openWithChildren }),
            }
          )
        },
      })
    )
  }, [allProjects, item])

  const style: React.CSSProperties = {
    opacity: activeId === item.id ? 0.35 : 1,
  }

  // Inside a folder, the row sits in the folder's guide-lined list.
  const nested = depth > 0
  // The drop line spans the row's pill.
  const dropInset = nested ? 'left-1 right-2' : 'left-2 right-2'

  const closestEdge =
    insertBeforeId === item.id
      ? ('top' as const)
      : insertBeforeId === `after:${item.id}`
        ? ('bottom' as const)
        : null

  if (isFolder(item)) {
    const isExpanded = expandedFolderIds.has(item.id)

    // The folder row, not this wrapper, carries `data-pdnd-tree-id`: the
    // wrapper also holds the child rows (see the drop target above).
    return (
      <div
        ref={elementRef}
        style={style}
        className={cn(
          'relative transition-opacity',
          activeId === item.id && 'cursor-grabbing'
        )}
      >
        <DropIndicator edge={closestEdge} insetClassName={dropInset} />
        <FolderTreeItem
          folder={item}
          nested={nested}
          childCount={allProjects.filter(p => p.parent_id === item.id).length}
          isDropTarget={isOverFolder}
          dragHandleRef={dragHandleRef}
        >
          {isExpanded && (
            <NestedItems
              projects={allProjects}
              parentId={item.id}
              depth={depth + 1}
              expandedFolderIds={expandedFolderIds}
              overFolderId={overFolderId}
              insertBeforeId={insertBeforeId}
              activeId={activeId}
            />
          )}
        </FolderTreeItem>
      </div>
    )
  }

  return (
    <div
      ref={elementRef}
      data-pdnd-tree-id={item.id}
      style={style}
      className={cn(
        'relative transition-opacity',
        activeId === item.id && 'cursor-grabbing'
      )}
    >
      <DropIndicator edge={closestEdge} insetClassName={dropInset} />
      <ProjectTreeItem
        project={item}
        dragHandleRef={dragHandleRef}
        nested={nested}
      />
    </div>
  )
}

// Renders nested items (children of a folder)
interface NestedItemsProps {
  projects: Project[]
  parentId: string
  depth: number
  expandedFolderIds: Set<string>
  overFolderId: string | null
  insertBeforeId: string | null
  activeId: string | null
}

function NestedItems({
  projects,
  parentId,
  depth,
  expandedFolderIds,
  overFolderId,
  insertBeforeId,
  activeId,
}: NestedItemsProps) {
  const items = getSortedSiblings(projects, parentId)

  return (
    <>
      {items.map(item => (
        <SortableItem
          key={item.id}
          item={item}
          allProjects={projects}
          depth={depth}
          isOverFolder={overFolderId === item.id}
          expandedFolderIds={expandedFolderIds}
          overFolderId={overFolderId}
          insertBeforeId={insertBeforeId}
          activeId={activeId}
        />
      ))}
    </>
  )
}

// Drop zone at the bottom to move items to root level
function RootDropZone({ isOver }: { isOver: boolean }) {
  const elementRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isProjectTreeDragData(source.data),
      getData: () => ({
        type: 'project-tree-item',
        targetId: ROOT_DROP_TARGET_ID,
        root: true,
      }),
    })
  }, [])

  return (
    <div
      ref={elementRef}
      className={cn(
        'mx-2 mt-1 rounded border-2 border-dashed transition-colors flex items-center justify-center py-2',
        isOver ? 'border-primary/50 bg-primary/5' : 'border-muted-foreground/25'
      )}
    >
      <span className="text-[11px] text-muted-foreground/50 select-none">
        Drop here to move to root level
      </span>
    </div>
  )
}

/**
 * The folders and projects of the Projects panel as one tree. The root lists
 * the folders, then the projects in no folder, each in its saved order: the
 * backend's `move_item` keeps folders first in every level.
 */
export function ProjectTree({ projects }: ProjectTreeProps) {
  const reorderItems = useReorderItems()
  const moveItem = useMoveItem()
  const expandFolder = useProjectsStore(state => state.expandFolder)
  const expandedFolderIds = useProjectsStore(state => state.expandedFolderIds)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overFolderId, setOverFolderId] = useState<string | null>(null)
  const [isOverRoot, setIsOverRoot] = useState(false)
  const [insertBeforeId, setInsertBeforeId] = useState<string | null>(null)
  const latestDropTargetRef = useRef<{
    targetId: string | null
    instruction: Instruction | null
  }>({ targetId: null, instruction: null })
  const activeIdRef = useRef(activeId)

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const rootItems = getSortedSiblings(projects, undefined)

  const clearDragState = useCallback(() => {
    setActiveId(null)
    setOverFolderId(null)
    setIsOverRoot(false)
    setInsertBeforeId(null)
    latestDropTargetRef.current = { targetId: null, instruction: null }
  }, [])

  const updateDragTargetState = useCallback(
    (
      targetId: string | null,
      instruction: Instruction | null,
      sourceId: string | null
    ) => {
      latestDropTargetRef.current = { targetId, instruction }
      if (!targetId) {
        setOverFolderId(null)
        setIsOverRoot(false)
        setInsertBeforeId(null)
        return
      }

      if (targetId === ROOT_DROP_TARGET_ID) {
        setOverFolderId(null)
        setIsOverRoot(true)
        setInsertBeforeId(null)
        return
      }

      setIsOverRoot(false)
      const target = projects.find(p => p.id === targetId)
      if (
        target &&
        isFolder(target) &&
        instruction?.operation === 'combine' &&
        !instruction.blocked &&
        sourceId &&
        canMoveIntoFolder({ projects, activeId: sourceId, folderId: target.id })
      ) {
        setOverFolderId(target.id)
        setInsertBeforeId(null)
        return
      }

      setOverFolderId(null)
      setInsertBeforeId(instructionToInsertBeforeId(targetId, instruction))
    },
    [projects]
  )

  const performTreeDrop = useCallback(
    (activeId: string, targetId: string, instruction: Instruction | null) => {
      const action = resolveTreeDrop(projects, activeId, targetId, instruction)
      if (action.type === 'move') {
        moveItem.mutate({
          itemId: action.itemId,
          newParentId: action.newParentId,
          targetIndex: action.targetIndex,
        })
        if (action.expandFolderId) expandFolder(action.expandFolderId)
        announceDrag(action.announcement)
      } else if (action.type === 'reorder') {
        reorderItems.mutate({
          itemIds: action.itemIds,
          parentId: action.parentId,
        })
        announceDrag(action.announcement)
      }
    },
    [expandFolder, moveItem, projects, reorderItems]
  )

  /**
   * The native drag fallback: the tree row under `element` and the
   * instruction for a pointer at `clientY`. Over the dragged row itself the
   * target is cleared, so a drop there leaves the item where it was.
   */
  const updateNativeDragTarget = useCallback(
    (element: Element | null, clientY: number, draggingId: string) => {
      const target = element?.closest<HTMLElement>('[data-pdnd-tree-id]')
      const targetId = target?.dataset.pdndTreeId ?? null
      if (!target || !targetId) return false
      if (targetId === draggingId) {
        updateDragTargetState(null, null, draggingId)
        return true
      }
      const targetProject = projects.find(p => p.id === targetId)
      if (!targetProject) return false

      const rect = target.getBoundingClientRect()
      const instruction = instructionAtRatio({
        ratio: (clientY - rect.top) / Math.max(rect.height, 1),
        canCombine:
          isFolder(targetProject) &&
          canMoveIntoFolder({
            projects,
            activeId: draggingId,
            folderId: targetId,
          }),
        openWithChildren: isOpenWithChildren(
          targetProject,
          projects,
          useProjectsStore.getState().expandedFolderIds
        ),
      })
      updateDragTargetState(targetId, instruction, draggingId)
      return true
    },
    [projects, updateDragTargetState]
  )

  const nativeTreeDropHandledRef = useRef(false)

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => isProjectTreeDragData(source.data),
      onDragStart: ({ source }) => {
        if (!isProjectTreeDragData(source.data)) return
        setActiveId(source.data.itemId)
        announceDrag('Started dragging item')
      },
      onDropTargetChange: ({ source, location }) => {
        if (!isProjectTreeDragData(source.data)) return
        const target = location.current.dropTargets.find(dropTarget =>
          isProjectTreeDropTargetData(dropTarget.data)
        )
        const instruction = target ? extractInstruction(target.data) : null
        const targetId =
          typeof target?.data.targetId === 'string'
            ? target.data.targetId
            : null
        updateDragTargetState(targetId, instruction, source.data.itemId)
      },
      onDrag: ({ source, location }) => {
        if (!isProjectTreeDragData(source.data)) return
        const target = location.current.dropTargets.find(dropTarget =>
          isProjectTreeDropTargetData(dropTarget.data)
        )
        const instruction = target ? extractInstruction(target.data) : null
        const targetId =
          typeof target?.data.targetId === 'string'
            ? target.data.targetId
            : null
        updateDragTargetState(targetId, instruction, source.data.itemId)
      },
      onDrop: ({ source, location }) => {
        if (nativeTreeDropHandledRef.current) {
          nativeTreeDropHandledRef.current = false
          return
        }
        if (!isProjectTreeDragData(source.data)) {
          clearDragState()
          return
        }
        const target = location.current.dropTargets.find(dropTarget =>
          isProjectTreeDropTargetData(dropTarget.data)
        )
        const fallback = latestDropTargetRef.current
        const targetId = target
          ? String(target.data.targetId)
          : fallback.targetId
        const instruction = target
          ? extractInstruction(target.data)
          : fallback.instruction
        clearDragState()
        if (!targetId) {
          announceDrag('Item move cancelled')
          return
        }
        performTreeDrop(source.data.itemId, targetId, instruction)
      },
    })
  }, [clearDragState, performTreeDrop, updateDragTargetState])

  const handleNativeTreeDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!activeId) return
      if (
        updateNativeDragTarget(
          event.target as HTMLElement | null,
          event.clientY,
          activeId
        )
      ) {
        event.preventDefault()
      }
    },
    [activeId, updateNativeDragTarget]
  )

  const handleNativeTreeDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!activeId) return
      event.preventDefault()
      event.stopPropagation()
      const fallback = latestDropTargetRef.current
      nativeTreeDropHandledRef.current = true
      clearDragState()
      if (fallback.targetId) {
        performTreeDrop(activeId, fallback.targetId, fallback.instruction)
      }
    },
    [activeId, clearDragState, performTreeDrop]
  )

  const handleNativeTreeDragEnd = useCallback(() => {
    clearDragState()
  }, [clearDragState])

  const onDocumentDragOver = useEffectEvent((event: DragEvent) => {
    const draggingId = activeIdRef.current
    if (!draggingId) return
    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (updateNativeDragTarget(element, event.clientY, draggingId)) {
      event.preventDefault()
    }
  })

  const onDocumentDrop = useEffectEvent((event: DragEvent) => {
    const draggingId = activeIdRef.current
    if (!draggingId) return
    const fallback = latestDropTargetRef.current
    if (!fallback.targetId) return
    event.preventDefault()
    event.stopPropagation()
    nativeTreeDropHandledRef.current = true
    clearDragState()
    performTreeDrop(draggingId, fallback.targetId, fallback.instruction)
  })

  const onDocumentDragEnd = useEffectEvent(() => {
    const draggingId = activeIdRef.current
    if (!draggingId) return
    clearDragState()
  })

  useEffect(() => {
    const handleDocumentDragOver = (event: DragEvent) =>
      onDocumentDragOver(event)
    const handleDocumentDrop = (event: DragEvent) => onDocumentDrop(event)
    const handleDocumentDragEnd = () => onDocumentDragEnd()

    document.addEventListener('dragover', handleDocumentDragOver, true)
    document.addEventListener('drop', handleDocumentDrop, true)
    document.addEventListener('dragend', handleDocumentDragEnd, true)

    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver, true)
      document.removeEventListener('drop', handleDocumentDrop, true)
      document.removeEventListener('dragend', handleDocumentDragEnd, true)
    }
  }, [])

  useEffect(() => {
    if (!overFolderId || expandedFolderIds.has(overFolderId)) return
    const timeoutId = window.setTimeout(() => {
      expandFolder(overFolderId)
      announceDrag('Folder expanded')
    }, 500)

    return () => window.clearTimeout(timeoutId)
  }, [expandFolder, expandedFolderIds, overFolderId])

  return (
    // `contents`: the rows share the scroller as their containing block, so
    // each folder and project row sticks in its slot (sidebar-sticky.ts).
    <div
      className="contents"
      onDragOver={handleNativeTreeDragOver}
      onDrop={handleNativeTreeDrop}
      onDragEnd={handleNativeTreeDragEnd}
    >
      {rootItems.length > 0 && (
        <div data-testid="sidebar-tree-items" className="sidebar-sticky-tree">
          {rootItems.map(item => (
            <SortableItem
              key={item.id}
              item={item}
              allProjects={projects}
              depth={0}
              isOverFolder={overFolderId === item.id}
              expandedFolderIds={expandedFolderIds}
              overFolderId={overFolderId}
              insertBeforeId={insertBeforeId}
              activeId={activeId}
            />
          ))}
        </div>
      )}

      {/* Root drop zone - visible when dragging an item that's inside a folder */}
      {activeId &&
        projects.find(p => p.id === activeId)?.parent_id !== undefined && (
          <RootDropZone isOver={isOverRoot} />
        )}
    </div>
  )
}
