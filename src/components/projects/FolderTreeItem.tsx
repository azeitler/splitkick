import { useCallback, useState, useRef, useEffect } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Project } from '@/types/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useRenameFolder } from '@/services/projects'
import { CollapsedCountBadge } from './CollapsedCountBadge'
import { FolderContextMenu } from './FolderContextMenu'
import {
  SIDEBAR_NESTED_CHILD_LIST,
  SIDEBAR_NESTED_ROW_SHAPE,
  SIDEBAR_PROJECT_ROW_PADDING,
  SIDEBAR_ROW_SHAPE,
  SIDEBAR_WORKTREE_LIST,
  SIDEBAR_WORKTREE_ROW_PADDING,
} from './sidebar-row-styles'
import { keepStuckRowInSlot } from './sidebar-sticky'

interface FolderTreeItemProps {
  folder: Project
  children: React.ReactNode
  /** Direct children (projects + sub-folders), shown as a badge when collapsed */
  childCount: number
  /** Sits in a parent folder's list: nested row shape, shifted guide line */
  nested?: boolean
  isDropTarget?: boolean
  /** Only this row starts a drag, not the nested items below it */
  dragHandleRef?: React.Ref<HTMLDivElement>
}

export function FolderTreeItem({
  folder,
  children,
  childCount,
  nested = false,
  isDropTarget,
  dragHandleRef,
}: FolderTreeItemProps) {
  const {
    expandedFolderIds,
    toggleFolderExpanded,
    editingFolderId,
    setEditingFolderId,
  } = useProjectsStore()
  const isExpanded = expandedFolderIds.has(folder.id)

  // Derive editing state from store - survives re-renders from query invalidation
  const isEditing = editingFolderId === folder.id
  const [editName, setEditName] = useState(folder.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const editStartTimeRef = useRef<number>(0)
  const renameFolder = useRenameFolder()

  // Sync editName when folder name changes or editing starts
  useEffect(() => {
    if (isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditName(folder.name)
      editStartTimeRef.current = Date.now()
    }
  }, [isEditing, folder.name])

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const stickyRef = useRef<HTMLDivElement>(null)
  const hasChildList = isExpanded && childCount > 0

  const handleClick = useCallback(() => {
    keepStuckRowInSlot(stickyRef.current)
    toggleFolderExpanded(folder.id)
  }, [folder.id, toggleFolderExpanded])

  const handleChevronClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      keepStuckRowInSlot(stickyRef.current)
      toggleFolderExpanded(folder.id)
    },
    [folder.id, toggleFolderExpanded]
  )

  const startEditing = useCallback(() => {
    setEditName(folder.name)
    setEditingFolderId(folder.id)
  }, [folder.name, folder.id, setEditingFolderId])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      startEditing()
    },
    [startEditing]
  )

  const handleSubmitRename = useCallback(
    (fromBlur = false) => {
      // Ignore blur events within 300ms of edit start (prevents re-render blur issues)
      if (fromBlur && Date.now() - editStartTimeRef.current < 300) {
        // Re-focus since blur was caused by DnD-Kit/ContextMenu re-render
        inputRef.current?.focus()
        return
      }

      const trimmedName = editName.trim()
      if (trimmedName && trimmedName !== folder.name) {
        renameFolder.mutate({ folderId: folder.id, name: trimmedName })
      }
      setEditingFolderId(null)
    },
    [editName, folder.name, folder.id, renameFolder, setEditingFolderId]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Stop propagation for all keys to prevent drag handlers from capturing them
      e.stopPropagation()

      if (e.key === 'Enter') {
        handleSubmitRename(false)
      } else if (e.key === 'Escape') {
        setEditName(folder.name)
        setEditingFolderId(null)
      }
    },
    [handleSubmitRename, folder.name, setEditingFolderId]
  )

  return (
    <FolderContextMenu folder={folder}>
      <div>
        {/* A top-level folder row sticks under the Starred and Folders
            headers while its projects scroll (sidebar-sticky.ts). Nested
            folders scroll, so the stack does not grow with the depth. */}
        <div
          ref={stickyRef}
          data-sidebar-sticky={nested ? undefined : ''}
          className={cn(
            !nested && 'sticky z-[3] bg-sidebar',
            // The gap above the children is part of this block, so a stuck
            // row keeps it to the next stuck row and the hairline (#59).
            hasChildList && 'pb-0.5'
          )}
          style={nested ? undefined : { top: 'var(--sb-folder-top)' }}
        >
          {/* Folder Row: the project row's shape, spacing and type, so the two
              read as siblings. A parent folder's list indents nested rows. */}
          <div
            ref={dragHandleRef}
            data-testid={`folder-row-${folder.id}`}
            className={cn(
              'group relative flex h-8 cursor-pointer items-center gap-1.5 overflow-hidden py-1.5 transition-colors duration-150',
              nested ? SIDEBAR_NESTED_ROW_SHAPE : SIDEBAR_ROW_SHAPE,
              nested
                ? SIDEBAR_WORKTREE_ROW_PADDING
                : SIDEBAR_PROJECT_ROW_PADDING,
              isDropTarget
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
          >
            {/* Folder Icon */}
            <button
              type="button"
              aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
              className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent-foreground/10"
              onClick={handleChevronClick}
            >
              {/* The project avatar's size. */}
              {isExpanded ? (
                <FolderOpen className="size-4" />
              ) : (
                <Folder className="size-4" />
              )}
            </button>

            {/* Name (editable) */}
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={() => handleSubmitRename(true)}
                onKeyDown={handleKeyDown}
                aria-label="Rename folder"
                className="flex-1 bg-transparent text-base outline-none ring-1 ring-primary/50 rounded px-1 md:text-sm"
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="flex flex-1 items-center gap-0.5 truncate text-sm">
                <span className="truncate">{folder.name}</span>
                {/* Hidden child count while the row is collapsed */}
                {!isExpanded && (
                  <CollapsedCountBadge count={childCount} noun="item" />
                )}
              </span>
            )}
          </div>
        </div>

        {/* Children (nested projects/folders), on the same guide line a
            project draws under its avatar for its workspaces */}
        {isExpanded && (
          <div
            className={cn(
              childCount > 0 && 'pb-0.5',
              childCount > 0 &&
                (nested ? SIDEBAR_NESTED_CHILD_LIST : SIDEBAR_WORKTREE_LIST)
            )}
          >
            {children}
          </div>
        )}
      </div>
    </FolderContextMenu>
  )
}
