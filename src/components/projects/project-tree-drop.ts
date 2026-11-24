import type {
  Instruction,
  Operation,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item'
import { isFolder, type Project } from '@/types/projects'
import { ROOT_DROP_TARGET_ID } from '@/lib/drag-and-drop/types'
import { reorderWithClosestEdge } from '@/lib/drag-and-drop/reorder'

/**
 * The drop logic of the projects tree, free of React and the DOM.
 *
 * A folder's drop target is its row only, never the rows of its children:
 * over a child the folder must not answer, or a drag that starts on the
 * first child reads as "before the folder" and moves it out (the bug this
 * module was split out for).
 */

const MAX_NESTING_DEPTH = 3

function getDepth(projects: Project[], itemId: string): number {
  const projectById = new Map(projects.map(p => [p.id, p]))
  let depth = 0
  let current = projectById.get(itemId)
  while (current?.parent_id) {
    depth++
    current = projectById.get(current.parent_id)
  }
  return depth
}

function getMaxSubtreeDepth(projects: Project[], itemId: string): number {
  const children = projects.filter(p => p.parent_id === itemId)
  if (children.length === 0) return 0
  return 1 + Math.max(...children.map(c => getMaxSubtreeDepth(projects, c.id)))
}

export function canMoveIntoFolder({
  projects,
  activeId,
  folderId,
}: {
  projects: Project[]
  activeId: string
  folderId: string
}): boolean {
  if (activeId === folderId) return false

  const projectById = new Map(projects.map(p => [p.id, p]))
  const activeItem = projectById.get(activeId)
  const folder = projectById.get(folderId)
  if (!activeItem || !folder || !isFolder(folder)) return false

  const folderDepth = getDepth(projects, folderId)
  const subtreeDepth = isFolder(activeItem)
    ? getMaxSubtreeDepth(projects, activeId)
    : 0
  if (folderDepth + 1 + subtreeDepth > MAX_NESTING_DEPTH) return false

  if (isFolder(activeItem)) {
    let currentParent = folder.parent_id
    while (currentParent) {
      if (currentParent === activeId) return false
      const parent = projectById.get(currentParent)
      currentParent = parent?.parent_id
    }
  }

  return true
}

/** Siblings in display order: folders first, then by `order` (the backend's
 *  `move_item` sorts the same way). */
export function getSortedSiblings(
  projects: Project[],
  parentId: string | undefined,
  excludeId?: string
): Project[] {
  return projects
    .filter(p => p.parent_id === parentId && p.id !== excludeId)
    .sort((a, b) => {
      if (isFolder(a) && !isFolder(b)) return -1
      if (!isFolder(a) && isFolder(b)) return 1
      return a.order - b.order
    })
}

/**
 * The operations a tree row offers. Below an open folder's row come its
 * children, so "after the folder" there would draw the line where the first
 * child starts but drop the item after the whole folder: the lower part of
 * the row means "into the folder" instead.
 */
export function treeRowOperations({
  canCombine,
  openWithChildren,
}: {
  canCombine: boolean
  openWithChildren: boolean
}): Partial<Record<Operation, 'available' | 'not-available'>> {
  return {
    'reorder-before': 'available',
    'reorder-after':
      canCombine && openWithChildren ? 'not-available' : 'available',
    combine: canCombine ? 'available' : 'not-available',
  }
}

/**
 * The instruction for a pointer at `ratio` (0 = top, 1 = bottom) of a row.
 * Mirrors the list-item hitbox, for the native drag fallback.
 */
export function instructionAtRatio({
  ratio,
  canCombine,
  openWithChildren,
}: {
  ratio: number
  canCombine: boolean
  openWithChildren: boolean
}): Instruction {
  const at = (operation: Operation): Instruction => ({
    operation,
    blocked: false,
    axis: 'vertical',
  })
  if (!canCombine) return at(ratio < 0.5 ? 'reorder-before' : 'reorder-after')
  if (ratio < 0.25) return at('reorder-before')
  if (ratio > 0.75 && !openWithChildren) return at('reorder-after')
  return at('combine')
}

export type TreeDropAction =
  | { type: 'none' }
  | {
      type: 'move'
      itemId: string
      newParentId: string | undefined
      targetIndex?: number
      /** Open this folder after the move (a drop into it). */
      expandFolderId?: string
      announcement: string
    }
  | {
      type: 'reorder'
      itemIds: string[]
      parentId: string | undefined
      announcement: string
    }

const NONE: TreeDropAction = { type: 'none' }

/** What a drop of `activeId` on `targetId` with `instruction` does. */
export function resolveTreeDrop(
  projects: Project[],
  activeId: string,
  targetId: string,
  instruction: Instruction | null
): TreeDropAction {
  const activeItem = projects.find(p => p.id === activeId)
  if (!activeItem) return NONE

  if (targetId === ROOT_DROP_TARGET_ID) {
    if (activeItem.parent_id === undefined) return NONE
    return {
      type: 'move',
      itemId: activeId,
      newParentId: undefined,
      announcement: 'Item moved to root level',
    }
  }

  const overItem = projects.find(p => p.id === targetId)
  if (!overItem || activeId === targetId) return NONE
  if (!instruction || instruction.blocked) return NONE

  if (instruction.operation === 'combine') {
    // Already in this folder: moving would only push it to the end.
    if (activeItem.parent_id === targetId) return NONE
    if (!canMoveIntoFolder({ projects, activeId, folderId: targetId })) {
      return NONE
    }
    return {
      type: 'move',
      itemId: activeId,
      newParentId: targetId,
      expandFolderId: targetId,
      announcement: `Item moved into ${overItem.name}`,
    }
  }

  const closestEdge =
    instruction.operation === 'reorder-before' ? 'top' : 'bottom'

  if (activeItem.parent_id !== overItem.parent_id) {
    const siblings = getSortedSiblings(projects, overItem.parent_id, activeId)
    const overIndex = siblings.findIndex(p => p.id === targetId)
    if (overIndex === -1) return NONE
    return {
      type: 'move',
      itemId: activeId,
      newParentId: overItem.parent_id,
      targetIndex: closestEdge === 'bottom' ? overIndex + 1 : overIndex,
      announcement: 'Item moved',
    }
  }

  const parentId = activeItem.parent_id
  const siblings = getSortedSiblings(projects, parentId)
  const oldIndex = siblings.findIndex(p => p.id === activeId)
  const newIndex = siblings.findIndex(p => p.id === targetId)
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return NONE

  const itemIds = reorderWithClosestEdge({
    items: siblings,
    startIndex: oldIndex,
    indexOfTarget: newIndex,
    closestEdgeOfTarget: closestEdge,
  }).map(p => p.id)
  if (itemIds.every((id, index) => id === siblings[index]?.id)) return NONE
  return {
    type: 'reorder',
    itemIds,
    parentId,
    announcement: 'Items reordered',
  }
}
