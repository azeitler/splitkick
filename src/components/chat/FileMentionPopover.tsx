import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FileIcon } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { useWorktreeFiles } from '@/services/files'
import type { WorktreeFile, PendingFile } from '@/types/chat'
import { cn } from '@/lib/utils'
import { generateId } from '@/lib/uuid'
import { getExtensionColor } from '@/lib/file-colors'

export interface FileMentionPopoverHandle {
  moveUp: () => void
  moveDown: () => void
  selectCurrent: () => void
}

interface FileMentionPopoverProps {
  /** Worktree path for file listing */
  worktreePath: string | null
  /** Whether the popover is open */
  open: boolean
  /** Callback when popover should close */
  onOpenChange: (open: boolean) => void
  /** Callback when a file is selected */
  onSelectFile: (file: PendingFile) => void
  /** Current search query (text after @) */
  searchQuery: string
  /** Position for the anchor (relative to textarea container) */
  anchorPosition: { top: number; left: number } | null
  /** Reference to the container for positioning (reserved for future use) */
  containerRef?: React.RefObject<HTMLElement | null>
  /** Ref to expose navigation methods to parent */
  handleRef?: React.RefObject<FileMentionPopoverHandle | null>
}

export function FileMentionPopover({
  worktreePath,
  open,
  onOpenChange,
  onSelectFile,
  searchQuery,
  anchorPosition,
  handleRef,
}: FileMentionPopoverProps) {
  const { data: files = [] } = useWorktreeFiles(worktreePath)
  const listRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Filter files based on search query (case-insensitive substring match)
  const filteredFiles = useMemo(() => {
    if (!searchQuery) {
      return files.slice(0, 15) // Show first 15 when no search
    }

    const query = searchQuery.toLowerCase()
    return files
      .filter(f => f.relative_path.toLowerCase().includes(query))
      .slice(0, 15) // Limit to 15 results
  }, [files, searchQuery])

  // Clamp selectedIndex to valid range (handles case when filter reduces results)
  const clampedSelectedIndex = Math.min(
    selectedIndex,
    Math.max(0, filteredFiles.length - 1)
  )

  const handleSelect = useCallback(
    (file: WorktreeFile) => {
      const pendingFile: PendingFile = {
        id: generateId(),
        relativePath: file.relative_path,
        extension: file.extension,
      }
      onSelectFile(pendingFile)
      onOpenChange(false)
    },
    [onSelectFile, onOpenChange]
  )

  // Expose navigation methods via ref for parent to call
  useImperativeHandle(handleRef, () => {
    console.log(
      '[FileMentionPopover] useImperativeHandle creating handle, filteredFiles.length:',
      filteredFiles.length
    )
    return {
      moveUp: () => {
        console.log(
          '[FileMentionPopover] moveUp called, current selectedIndex:',
          selectedIndex
        )
        setSelectedIndex(i => Math.max(i - 1, 0))
      },
      moveDown: () => {
        console.log(
          '[FileMentionPopover] moveDown called, current selectedIndex:',
          selectedIndex,
          'max:',
          filteredFiles.length - 1
        )
        setSelectedIndex(i => Math.min(i + 1, filteredFiles.length - 1))
      },
      selectCurrent: () => {
        console.log(
          '[FileMentionPopover] selectCurrent called, clampedSelectedIndex:',
          clampedSelectedIndex
        )
        if (filteredFiles[clampedSelectedIndex]) {
          handleSelect(filteredFiles[clampedSelectedIndex])
        }
      },
    }
  }, [filteredFiles, clampedSelectedIndex, handleSelect, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const selectedItem = list.querySelector(
      `[data-index="${clampedSelectedIndex}"]`
    )
    selectedItem?.scrollIntoView({ block: 'nearest' })
  }, [clampedSelectedIndex])

  if (!open || !anchorPosition) return null

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor
        style={{
          position: 'absolute',
          top: anchorPosition.top,
          left: anchorPosition.left,
          pointerEvents: 'none',
        }}
      />
      <PopoverContent
        className="w-96 p-0"
        align="start"
        side="top"
        sideOffset={4}
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList ref={listRef} className="max-h-[200px]">
            {filteredFiles.length === 0 ? (
              <CommandEmpty>No files found</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredFiles.map((file, index) => {
                  const isSelected = index === clampedSelectedIndex
                  return (
                    <CommandItem
                      key={file.relative_path}
                      data-index={index}
                      value={file.relative_path}
                      onSelect={() => handleSelect(file)}
                      className={cn(
                        'flex items-center gap-2 cursor-pointer',
                        // Override cmdk's internal selection styling - we manage selection ourselves
                        'data-[selected=true]:bg-transparent data-[selected=true]:text-foreground',
                        isSelected && '!bg-accent !text-accent-foreground'
                      )}
                    >
                      <FileIcon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          getExtensionColor(file.extension)
                        )}
                      />
                      <span className="truncate text-sm">
                        {file.relative_path}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
