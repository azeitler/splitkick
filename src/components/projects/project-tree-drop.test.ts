import { describe, expect, it } from 'vitest'
import type { Project } from '@/types/projects'
import { ROOT_DROP_TARGET_ID } from '@/lib/drag-and-drop/types'
import {
  instructionAtRatio,
  resolveTreeDrop,
  treeRowOperations,
} from './project-tree-drop'

const item = (
  id: string,
  order: number,
  extra: Partial<Project> = {}
): Project => ({
  id,
  name: id,
  path: extra.is_folder ? '' : `/tmp/${id}`,
  default_branch: 'main',
  added_at: 0,
  order,
  ...extra,
})

// Root: folder "work" (holding a, b), then project "solo".
const projects: Project[] = [
  item('work', 0, { is_folder: true }),
  item('a', 0, { parent_id: 'work' }),
  item('b', 1, { parent_id: 'work' }),
  item('solo', 1),
]

const at = (operation: 'reorder-before' | 'reorder-after' | 'combine') => ({
  operation,
  blocked: false,
  axis: 'vertical' as const,
})

describe('resolveTreeDrop', () => {
  it('leaves the first child of a folder in place when dropped on its own folder', () => {
    // The drag of the first child that ends over its folder row's body.
    expect(resolveTreeDrop(projects, 'a', 'work', at('combine'))).toEqual({
      type: 'none',
    })
  })

  it('does nothing without a target or instruction', () => {
    expect(resolveTreeDrop(projects, 'a', 'a', at('reorder-before'))).toEqual({
      type: 'none',
    })
    expect(resolveTreeDrop(projects, 'a', 'b', null)).toEqual({ type: 'none' })
  })

  it('does nothing when a child is dropped back on its own edge', () => {
    // Before its next sibling is where it already is.
    expect(resolveTreeDrop(projects, 'a', 'b', at('reorder-before'))).toEqual({
      type: 'none',
    })
  })

  it('reorders inside the folder', () => {
    expect(resolveTreeDrop(projects, 'a', 'b', at('reorder-after'))).toEqual({
      type: 'reorder',
      itemIds: ['b', 'a'],
      parentId: 'work',
      announcement: 'Items reordered',
    })
  })

  it('moves a child out when it is really dropped above the folder row', () => {
    expect(
      resolveTreeDrop(projects, 'a', 'work', at('reorder-before'))
    ).toMatchObject({
      type: 'move',
      itemId: 'a',
      newParentId: undefined,
      targetIndex: 0,
    })
  })

  it('moves a child out next to a root project', () => {
    expect(
      resolveTreeDrop(projects, 'a', 'solo', at('reorder-after'))
    ).toMatchObject({ type: 'move', newParentId: undefined, targetIndex: 2 })
  })

  it('moves a child to the root through the root drop zone', () => {
    expect(
      resolveTreeDrop(projects, 'b', ROOT_DROP_TARGET_ID, null)
    ).toMatchObject({ type: 'move', itemId: 'b', newParentId: undefined })
    expect(
      resolveTreeDrop(projects, 'solo', ROOT_DROP_TARGET_ID, null)
    ).toEqual({ type: 'none' })
  })

  it('moves a root project into a folder and opens it', () => {
    expect(
      resolveTreeDrop(projects, 'solo', 'work', at('combine'))
    ).toMatchObject({
      type: 'move',
      itemId: 'solo',
      newParentId: 'work',
      expandFolderId: 'work',
    })
  })
})

describe('treeRowOperations', () => {
  it('turns "after an open folder" into "into the folder"', () => {
    expect(
      treeRowOperations({ canCombine: true, openWithChildren: true })
    ).toEqual({
      'reorder-before': 'available',
      'reorder-after': 'not-available',
      combine: 'available',
    })
  })

  it('keeps "after" for a closed folder and for projects', () => {
    expect(
      treeRowOperations({ canCombine: true, openWithChildren: false })[
        'reorder-after'
      ]
    ).toBe('available')
    expect(
      treeRowOperations({ canCombine: false, openWithChildren: false })
    ).toEqual({
      'reorder-before': 'available',
      'reorder-after': 'available',
      combine: 'not-available',
    })
  })
})

describe('instructionAtRatio', () => {
  it('splits a project row in halves', () => {
    const flags = { canCombine: false, openWithChildren: false }
    expect(instructionAtRatio({ ratio: 0.4, ...flags }).operation).toBe(
      'reorder-before'
    )
    expect(instructionAtRatio({ ratio: 0.6, ...flags }).operation).toBe(
      'reorder-after'
    )
  })

  it('reads the lower part of an open folder row as "into the folder"', () => {
    const flags = { canCombine: true, openWithChildren: true }
    expect(instructionAtRatio({ ratio: 0.1, ...flags }).operation).toBe(
      'reorder-before'
    )
    expect(instructionAtRatio({ ratio: 0.9, ...flags }).operation).toBe(
      'combine'
    )
  })

  it('keeps "after" at the bottom of a closed folder row', () => {
    const flags = { canCombine: true, openWithChildren: false }
    expect(instructionAtRatio({ ratio: 0.5, ...flags }).operation).toBe(
      'combine'
    )
    expect(instructionAtRatio({ ratio: 0.9, ...flags }).operation).toBe(
      'reorder-after'
    )
  })
})
