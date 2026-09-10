import {
  Archive,
  Copy,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { copyToClipboard } from '@/lib/clipboard'
import { queryClient } from '@/lib/query-client'
import { canReconnectSession, reconnectNativeCliSession } from '@/services/chat'
import type { Session } from '@/types/chat'
import { SessionLabelsSubmenu } from './LabelsSubmenu'
import { SessionStatusMenu } from './SessionStatusMenu'
import {
  getResumeCommand,
  type ManualSessionStatus,
  type SessionCardData,
} from './session-card-utils'

interface SessionContextMenuItemsProps {
  card: SessionCardData
  worktreeId: string
  onRename: (sessionId: string, currentName: string) => void
  /** Opens the label modal, used by the "Manage labels…" submenu item. */
  onManageLabels: (sessionId: string) => void
  onArchive: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  /** Optional host-provided native-client launcher (canvas tab bar only). */
  onOpenInNativeClient?: (session: Session) => void
  /** Disables the native-client item while the host is creating a session. */
  openInNativeClientDisabled?: boolean
  /** Tailwind width class for the menu content (defaults to w-64). */
  contentClassName?: string
  /** Project owning the session's worktree. Omit to hide the pin and star items. */
  projectId?: string
}

/**
 * Canonical session context menu — shared by the canvas session tab bar
 * (SessionChatModal) and the sidebar worktree session rows (WorktreeItem).
 * Status/Pause/Resume/Reconnect and the Labels submenu are self-contained;
 * rename/archive/delete and the label modal are delegated to the host so each
 * surface can wire its own UI (inline rename, archive confirmation, etc.).
 */
export function SessionContextMenuItems({
  card,
  worktreeId,
  onRename,
  onManageLabels,
  onArchive,
  onDelete,
  onOpenInNativeClient,
  openInNativeClientDisabled = false,
  contentClassName = 'w-64',
  projectId,
}: SessionContextMenuItemsProps) {
  const session = card.session
  const isPausedOverride = card.statusOverride === 'paused'
  // Select a boolean, not the pins array: the selector must subscribe to the
  // value that decides the label, or the item would not flip after a pin.
  const isPinned = useProjectsStore(state =>
    projectId
      ? (state.projectCanvasSettings[projectId]?.pinnedSessions ?? []).some(
          pin => pin.sessionId === session.id
        )
      : false
  )
  const isStarred = useProjectsStore(state =>
    state.starredSessions.some(star => star.sessionId === session.id)
  )
  const resumeCommand = getResumeCommand(session)

  return (
    <ContextMenuContent className={contentClassName}>
      <ContextMenuItem onSelect={() => onRename(session.id, session.name)}>
        <Pencil className="mr-2 h-4 w-4" />
        Rename
      </ContextMenuItem>
      <SessionLabelsSubmenu
        sessionId={session.id}
        currentLabel={card.label}
        onManage={() => onManageLabels(session.id)}
      />
      {projectId && (
        <ContextMenuItem
          onSelect={() => {
            const store = useProjectsStore.getState()
            if (isPinned) {
              store.unpinSessionFromProject(projectId, session.id)
            } else {
              store.pinSessionToProject(projectId, session.id, worktreeId)
            }
          }}
        >
          {isPinned ? (
            <>
              <PinOff className="mr-2 h-4 w-4" />
              Unpin from Project
            </>
          ) : (
            <>
              <Pin className="mr-2 h-4 w-4" />
              Pin to Project
            </>
          )}
        </ContextMenuItem>
      )}
      {/* A pin is local to one project; a star is global. Both can be set. */}
      {projectId && (
        <ContextMenuItem
          onSelect={() => {
            const store = useProjectsStore.getState()
            if (isStarred) {
              store.unstarSession(session.id)
            } else {
              store.starSession({
                projectId,
                worktreeId,
                sessionId: session.id,
              })
              // The Starred section and Home resolve stars against the
              // all-sessions cache, which never refreshes on focus. A session
              // created since the last fetch (here, by an agent, or by another
              // Jean) is not in it, so its star would never show. Refetch.
              void queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
            }
          }}
        >
          {isStarred ? (
            <>
              <StarOff className="mr-2 h-4 w-4" />
              Unstar
            </>
          ) : (
            <>
              <Star className="mr-2 h-4 w-4" />
              Star
            </>
          )}
        </ContextMenuItem>
      )}
      <SessionStatusMenu
        statusOverride={card.statusOverride}
        automaticStatus={card.automaticStatus}
        onSetStatusOverride={(next: ManualSessionStatus | null) => {
          useChatStore.getState().setSessionStatusOverride(session.id, next)
        }}
      />
      <ContextMenuItem
        // Quick toggle for the 'paused' override that the Status submenu
        // also exposes. Live states still outrank it visually, but the override
        // is remembered and applies once the session goes idle.
        onSelect={() => {
          useChatStore
            .getState()
            .setSessionPaused(session.id, !isPausedOverride)
        }}
      >
        {isPausedOverride ? (
          <>
            <Play className="mr-2 h-4 w-4" />
            Unpause
          </>
        ) : (
          <>
            <Pause className="mr-2 h-4 w-4" />
            Mark as Paused
          </>
        )}
      </ContextMenuItem>
      {resumeCommand && (
        <>
          {onOpenInNativeClient && (
            <ContextMenuItem
              disabled={openInNativeClientDisabled}
              onSelect={() => onOpenInNativeClient(session)}
            >
              <Play className="mr-2 h-4 w-4" />
              Open in Native Client
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onSelect={() => {
              void copyToClipboard(resumeCommand)
                .then(() => toast.success('Resume command copied'))
                .catch(() => toast.error('Failed to copy resume command'))
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            Native Resume Command
          </ContextMenuItem>
        </>
      )}
      {canReconnectSession(session) && (
        <ContextMenuItem
          onSelect={() => void reconnectNativeCliSession(session, worktreeId)}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Reconnect
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onArchive(session.id)}>
        <Archive className="mr-2 h-4 w-4" />
        Archive Session
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          void copyToClipboard(session.id)
            .then(() => toast.success('Session ID copied'))
            .catch(() => toast.error('Failed to copy session ID'))
        }}
      >
        <Copy className="mr-2 h-4 w-4" />
        Copy Session ID
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onSelect={() => onDelete(session.id)}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete Session
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

/**
 * Dismiss any open Radix context menu before a new one opens. Radix
 * `ContextMenu.Root` is uncontrolled (no `open` prop), so we cannot force-close
 * a sibling menu directly. Dispatching a primary-button `pointerdown` on the
 * document fires every open DismissableLayer's `onPointerDownOutside`, closing
 * them — without triggering Escape handlers (which would close the host modal).
 * Wire to `onContextMenuCapture` on each trigger so it runs before the new
 * menu's contextmenu handler.
 */
export function closeOpenSessionContextMenus() {
  document.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0 })
  )
}
