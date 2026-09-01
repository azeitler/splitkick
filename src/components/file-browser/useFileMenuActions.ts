import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { copyToClipboard } from '@/lib/clipboard'
import { getFilename, joinPaths } from '@/lib/path-utils'
import { getFileManagerName } from '@/lib/platform'
import { generateId } from '@/lib/uuid'
import { logger } from '@/lib/logger'
import { usePreferences } from '@/services/preferences'
import { useRevealPathInFileManager } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import type { PendingFile } from '@/types/chat'
import { getEditorLabel, getTerminalLabel } from '@/types/preferences'
import type { FileTreeNode } from './build-file-tree'

/**
 * Handlers for the Files sidebar row context menu.
 *
 * Mirrors `useWorktreeMenuActions`: the hook owns every side effect so the menu
 * component stays presentational and can be reused by a future kebab menu.
 */
export function useFileMenuActions(rootPath: string | null) {
  const { data: preferences } = usePreferences()
  const revealPath = useRevealPathInFileManager()

  const editorLabel = useMemo(
    () => getEditorLabel(preferences?.editor),
    [preferences?.editor]
  )
  const terminalLabel = useMemo(
    () => getTerminalLabel(preferences?.terminal),
    [preferences?.terminal]
  )

  const absolutePathOf = useCallback(
    (node: FileTreeNode) =>
      rootPath ? joinPaths(rootPath, node.relativePath) : null,
    [rootPath]
  )

  const handleReveal = useCallback(
    (node: FileTreeNode) => {
      const path = absolutePathOf(node)
      if (!path) return
      revealPath.mutate(path)
    },
    [absolutePathOf, revealPath]
  )

  const openWith = useCallback(
    async (
      node: FileTreeNode,
      command: string,
      args: Record<string, unknown>,
      label: string
    ) => {
      const path = absolutePathOf(node)
      if (!path) return
      const toastId = toast.loading(`Opening in ${label}…`)
      try {
        await invoke(command, { path, ...args })
        toast.success(`Opened in ${label}`, { id: toastId })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Failed to open in ${label}`, { error })
        toast.error(`Failed to open in ${label}`, {
          id: toastId,
          description: message,
        })
      }
    },
    [absolutePathOf]
  )

  const handleOpenInEditor = useCallback(
    (node: FileTreeNode) => {
      void openWith(
        node,
        'open_file_in_default_app',
        { editor: preferences?.editor },
        editorLabel
      )
    },
    [openWith, preferences?.editor, editorLabel]
  )

  const handleOpenInDefaultApp = useCallback(
    (node: FileTreeNode) => {
      // `open_file_in_default_app` always launches an editor; this is the real
      // shell-association open (image viewer, PDF reader, and so on).
      void openWith(node, 'open_path_in_default_app', {}, 'the default app')
    },
    [openWith]
  )

  const handleOpenInTerminal = useCallback(
    async (node: FileTreeNode) => {
      const path = absolutePathOf(node)
      if (!path) return
      try {
        await invoke('open_worktree_in_terminal', {
          worktreePath: path,
          terminal: preferences?.terminal,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Failed to open in Terminal', { error })
        toast.error('Failed to open in Terminal', { description: message })
      }
    },
    [absolutePathOf, preferences?.terminal]
  )

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await copyToClipboard(text)
      toast.success(`${label} copied`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Failed to copy ${label.toLowerCase()}`, {
        description: message,
      })
    }
  }, [])

  const handleCopyPath = useCallback(
    (node: FileTreeNode) => {
      const path = absolutePathOf(node)
      if (!path) return
      void copyText(path, 'Path')
    },
    [absolutePathOf, copyText]
  )

  const handleCopyRelativePath = useCallback(
    (node: FileTreeNode) => {
      void copyText(node.relativePath, 'Relative path')
    },
    [copyText]
  )

  /**
   * Add the row as an `@mention` in the chat composer. Reuses the pending-file
   * store the `@` popover writes to, plus the existing `append-chat-input`
   * window event so the composer text and the attachment stay in sync.
   */
  const handleAddToChat = useCallback((node: FileTreeNode) => {
    const { activeWorktreeId, getActiveSession, addPendingFile } =
      useChatStore.getState()
    const sessionId = activeWorktreeId
      ? getActiveSession(activeWorktreeId)
      : undefined

    if (!sessionId) {
      toast.error('Open a session first to mention a file')
      return
    }

    const pendingFile: PendingFile = {
      id: generateId(),
      relativePath: node.relativePath,
      extension: node.extension,
      isDirectory: node.isDir,
    }
    addPendingFile(sessionId, pendingFile)

    window.dispatchEvent(
      new CustomEvent('append-chat-input', {
        detail: { text: `@${getFilename(node.relativePath)} ` },
      })
    )
  }, [])

  return {
    fileManagerName: getFileManagerName(),
    editorLabel,
    terminalLabel,
    handleReveal,
    handleOpenInEditor,
    handleOpenInDefaultApp,
    handleOpenInTerminal,
    handleCopyPath,
    handleCopyRelativePath,
    handleAddToChat,
  }
}
