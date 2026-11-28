import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Pencil, Send, TriangleAlert, WifiOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  OFFLINE_TEXT,
  useOfflineReason,
  useSidebarFooterShown,
} from '@/components/layout/OfflineIndicator'
import {
  discardPrompt,
  editUnsentPrompt,
  selectSessionUnsent,
  selectSessionWaiting,
  useOutboxStore,
  type OutboxEntry,
} from '@/lib/prompt-outbox'
import { formatRelativeTime } from '@/lib/relative-time'

interface UnsentPromptsProps {
  sessionId: string
  onSendAgain: (entry: OutboxEntry) => void
}

function attachmentCount(entry: OutboxEntry): number {
  const q = entry.queued
  if (!q) return 0
  return (
    q.pendingImages.length +
    q.pendingFiles.length +
    q.pendingSkills.length +
    q.pendingTextFiles.length
  )
}

/**
 * Prompts of this session that the backend does not hold, above the input:
 * "Send again", "Edit" (into the input) and "Discard" (no confirm: nothing in
 * the chat flow asks, see docs/developer/confirm-dialogs.md).
 *
 * It also carries the offline sign where no sidebar footer shows it (phone,
 * hidden sidebar, zen mode), and says that a message sent while the backend
 * is unreachable waits for the connection.
 */
export const UnsentPrompts = memo(function UnsentPrompts({
  sessionId,
  onSendAgain,
}: UnsentPromptsProps) {
  const reason = useOfflineReason()
  const footerShown = useSidebarFooterShown()
  const unsent = useOutboxStore(
    useShallow(state => selectSessionUnsent(state, sessionId))
  )
  const waiting = useOutboxStore(state =>
    selectSessionWaiting(state, sessionId)
  )

  const showReason = !!reason && !footerShown
  const showWaiting = reason === 'backend' && waiting > 0

  if (unsent.length === 0 && !showReason && !showWaiting) return null

  return (
    <div
      data-testid="unsent-prompts"
      className="mb-2 flex flex-col gap-1.5 px-2 md:px-0"
    >
      {(showReason || showWaiting) && (
        <div
          role="status"
          data-testid="chat-offline-status"
          className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-foreground"
        >
          <WifiOff className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            {showReason && reason && (
              <span data-testid="offline-indicator" data-reason={reason}>
                {OFFLINE_TEXT[reason]}
              </span>
            )}
            {showReason && showWaiting && ' '}
            {showWaiting && (
              <span data-testid="outbox-waiting">
                {showReason ? '' : 'Offline. '}Your message is saved and will
                send when the connection is back.
              </span>
            )}
          </span>
        </div>
      )}
      {unsent.map(entry => {
        const attachments = attachmentCount(entry)
        return (
          <div
            key={entry.id}
            data-testid="unsent-prompt"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-foreground">
                Unsent message
              </span>
              <span title={new Date(entry.createdAt).toLocaleString()}>
                {formatRelativeTime(entry.createdAt)}
              </span>
              {attachments > 0 && (
                <span>
                  · {attachments} attachment{attachments === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-foreground">
              {entry.text}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-7"
                disabled={reason === 'backend'}
                onClick={() => onSendAgain(entry)}
              >
                <Send className="size-3.5" />
                Send again
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => editUnsentPrompt(entry)}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => discardPrompt(entry.id)}
              >
                <X className="size-3.5" />
                Discard
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
})
