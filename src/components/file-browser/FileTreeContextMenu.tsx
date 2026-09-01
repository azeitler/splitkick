import {
  ClipboardCopy,
  Code,
  ExternalLink,
  FileText,
  FolderOpen,
  MessageSquarePlus,
  Terminal,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { canOpenInEditor, canOpenNativeApps } from '@/lib/environment'
import type { FileTreeNode } from './build-file-tree'
import type { useFileMenuActions } from './useFileMenuActions'

interface FileTreeContextMenuProps {
  node: FileTreeNode
  /** Computed once by the sidebar so the hook does not run per row. */
  actions: ReturnType<typeof useFileMenuActions>
  /** Open a file in Jean's built-in viewer. Not shown for directories. */
  onOpen: (node: FileTreeNode) => void
  children: React.ReactNode
}

export function FileTreeContextMenu({
  node,
  actions,
  onOpen,
  children,
}: FileTreeContextMenuProps) {
  const {
    fileManagerName,
    editorLabel,
    terminalLabel,
    handleReveal,
    handleOpenInEditor,
    handleOpenInDefaultApp,
    handleOpenInTerminal,
    handleCopyPath,
    handleCopyRelativePath,
    handleAddToChat,
  } = actions

  const nativeOpen = canOpenNativeApps()
  const editorOpen = canOpenInEditor()
  const isFile = !node.isDir

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {isFile && (
          <ContextMenuItem onSelect={() => onOpen(node)}>
            <FileText className="mr-2 h-4 w-4" />
            Open
          </ContextMenuItem>
        )}
        {editorOpen && (
          <ContextMenuItem onSelect={() => handleOpenInEditor(node)}>
            <Code className="mr-2 h-4 w-4" />
            Open in {editorLabel}
          </ContextMenuItem>
        )}
        {isFile && nativeOpen && (
          <ContextMenuItem onSelect={() => handleOpenInDefaultApp(node)}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open in Default App
          </ContextMenuItem>
        )}
        {nativeOpen && (
          <ContextMenuItem onSelect={() => handleReveal(node)}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Reveal in {fileManagerName}
          </ContextMenuItem>
        )}
        {node.isDir && nativeOpen && (
          <ContextMenuItem onSelect={() => void handleOpenInTerminal(node)}>
            <Terminal className="mr-2 h-4 w-4" />
            Open in {terminalLabel}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => handleAddToChat(node)}>
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          Add to Chat
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => handleCopyPath(node)}>
          <ClipboardCopy className="mr-2 h-4 w-4" />
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => handleCopyRelativePath(node)}>
          <ClipboardCopy className="mr-2 h-4 w-4" />
          Copy Relative Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
