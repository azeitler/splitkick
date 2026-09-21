import { useCallback, useContext, useState, type ReactElement } from 'react'
import { Copy, ExternalLink, GitFork } from '@/components/icons/reicon'
import { toast } from 'sonner'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { copyToClipboard } from '@/lib/clipboard'
import {
  canOpenInEmbeddedBrowser,
  classifyChatLink,
  LocalPathRootContext,
  openChatLink,
} from '@/lib/chat-links'

/** Read the current window selection as trimmed plain text. */
export function getTrimmedSelectionText(): string {
  if (typeof window === 'undefined') return ''
  return window.getSelection()?.toString().trim() ?? ''
}

/**
 * Suppress the browser/OS default context menu on empty chat-thread chrome
 * (padding, gaps between messages) while leaving message-level custom menus
 * free to handle their own right-clicks.
 */
export function suppressDefaultContextMenu(
  event: React.MouseEvent | MouseEvent
): void {
  event.preventDefault()
}

interface MessageThreadContextMenuProps {
  children: ReactElement
  /**
   * Full message/response text for the "Copy message" / "Copy response" action.
   * Ignored when `onCopyMessage` is provided.
   */
  messageText?: string
  /** Label for the full-message copy action. */
  copyMessageLabel?: string
  /**
   * Custom full-message copy handler (e.g. rich user-prompt clipboard with
   * attachment metadata). Falls back to copying `messageText`.
   */
  onCopyMessage?: () => void | Promise<void>
  /**
   * Fork the session, keeping history up to this message. Omit to hide the item —
   * streaming messages have a run in flight and cannot be forked.
   */
  onForkFromHere?: () => void
}

/**
 * Custom right-click menu for session-thread messages.
 * Replaces the unusable browser default (Back / Refresh / Save as / Print)
 * with copy-focused actions.
 */
export function MessageThreadContextMenu({
  children,
  messageText = '',
  copyMessageLabel = 'Copy message',
  onCopyMessage,
  onForkFromHere,
}: MessageThreadContextMenuProps) {
  const [selection, setSelection] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkHref, setLinkHref] = useState('')
  const rootPath = useContext(LocalPathRootContext)

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    const target = event.target
    const link = target instanceof Element ? target.closest('a[href]') : null
    const anchor = link instanceof HTMLAnchorElement ? link : null
    setLinkUrl(anchor ? anchor.href : '')
    // The raw attribute, not the resolved href: a relative path in a response
    // resolves against the worktree, not against the app's own origin.
    setLinkHref(anchor?.getAttribute('href') ?? '')
  }, [])

  const handleOpenChange = useCallback((open: boolean) => {
    // Capture selection when the menu opens — opening the menu can clear
    // the live Selection before the user picks an item.
    if (open) {
      setSelection(getTrimmedSelectionText())
    }
  }, [])

  const handleCopySelection = useCallback(() => {
    if (!selection) return
    void copyToClipboard(selection)
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => toast.error('Failed to copy'))
  }, [selection])

  const handleCopyUrl = useCallback(() => {
    if (!linkUrl) return
    void copyToClipboard(linkUrl)
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => toast.error('Failed to copy'))
  }, [linkUrl])

  const handleOpenInDefaultBrowser = useCallback(() => {
    openChatLink(linkHref, { system: true, rootPath })
  }, [linkHref, rootPath])

  const handleCopyMessage = useCallback(() => {
    if (onCopyMessage) {
      void Promise.resolve(onCopyMessage()).catch(() => {
        toast.error('Failed to copy')
      })
      return
    }
    const text = messageText.trim()
    if (!text) return
    void copyToClipboard(text)
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => toast.error('Failed to copy'))
  }, [messageText, onCopyMessage])

  // A web link, or a local HTML page this machine can reach. Any other local
  // file would open in an editor, not a browser, so the item stays hidden.
  const linkKind = classifyChatLink(linkHref)
  const canOpenInDefaultBrowser =
    linkKind === 'web' ||
    (linkKind === 'page' && canOpenInEmbeddedBrowser(linkKind))
  const canCopyMessage = Boolean(onCopyMessage || messageText.trim())
  const canCopySelection = selection.length > 0

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {canOpenInDefaultBrowser && (
          <ContextMenuItem onSelect={handleOpenInDefaultBrowser}>
            <ExternalLink className="h-4 w-4" />
            Open in Default Browser
          </ContextMenuItem>
        )}
        {linkUrl && (
          <ContextMenuItem onSelect={handleCopyUrl}>
            <Copy className="h-4 w-4" />
            Copy URL
          </ContextMenuItem>
        )}
        {canCopySelection && (
          <ContextMenuItem onSelect={handleCopySelection}>
            <Copy className="h-4 w-4" />
            Copy
          </ContextMenuItem>
        )}
        {canCopyMessage && (
          <ContextMenuItem onSelect={handleCopyMessage}>
            <Copy className="h-4 w-4" />
            {copyMessageLabel}
          </ContextMenuItem>
        )}
        {!canCopySelection && !canCopyMessage && !onForkFromHere && (
          <ContextMenuItem disabled>No text to copy</ContextMenuItem>
        )}
        {onForkFromHere && (
          <>
            {(canCopySelection || canCopyMessage) && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={onForkFromHere}>
              <GitFork className="h-4 w-4" />
              Fork from here
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
