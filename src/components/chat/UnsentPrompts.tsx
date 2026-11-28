import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CloudOff, Pencil, Send, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBackendOffline } from '@/lib/backend-online'
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
 * the chat flow asks, see docs/developer/confirm-dialogs.md). While offline it
 * also says that a submitted message waits for the connection.
 */
export const UnsentPrompts = memo(function UnsentPrompts({
  sessionId,
  onSendAgain,
}: UnsentPromptsProps) {
  const offline = useBackendOffline()
  const unsent = useOutboxStore(
    useShallow(state => selectSessionUnsent(state, sessionId))
  )
  const waiting = useOutboxStore(state =>
    selectSessionWaiting(state, sessionId)
  )

  if (unsent.length === 0 && !(offline && waiting > 0)) return null

  return (
    <div
      data-testid="unsent-prompts"
      className="mb-2 flex flex-col gap-1.5 px-2 md:px-0"
    >
      {offline && waiting > 0 && (
        <div
          role="status"
          data-testid="outbox-waiting"
          className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-foreground"
        >
          <CloudOff className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            Offline. Your message is saved and will send when the connection is
            back.
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
                disabled={offline}
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
