import { memo, useCallback } from 'react'
import { Clock, Play, X } from 'lucide-react'
import { ImageLightbox } from '@/components/chat/ImageLightbox'
import { TextFileLightbox } from '@/components/chat/TextFileLightbox'
import { FileMentionBadge } from '@/components/chat/FileMentionBadge'
import { SkillBadge } from '@/components/chat/SkillBadge'
import { MessageSettingsBadges } from '@/components/chat/MessageSettingsBadges'
import { normalizePath } from '@/lib/path-utils'
import type { QueuedMessage } from '@/types/chat'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

interface QueuedMessageItemProps {
  message: QueuedMessage
  index: number
  sessionId: string
  worktreePath?: string
  onRemove: (sessionId: string, messageId: string) => void
  onForceSend?: (sessionId: string) => void
  isSessionIdle?: boolean
}

/**
 * Single queued message display
 * Memoized to prevent re-renders when sibling messages change
 */
export const QueuedMessageItem = memo(function QueuedMessageItem({
  message,
  index,
  sessionId,
  worktreePath,
  onRemove,
  onForceSend,
  isSessionIdle,
}: QueuedMessageItemProps) {
  const handleRemove = useCallback(() => {
    onRemove(sessionId, message.id)
  }, [onRemove, sessionId, message.id])

  const handleForceSend = useCallback(() => {
    onForceSend?.(sessionId)
  }, [onForceSend, sessionId])

  const showForceSend = index === 0 && isSessionIdle && onForceSend

  return (
    <div className="w-full flex justify-end overflow-visible">
      <div className="relative group text-foreground border border-dashed border-muted-foreground/40 rounded-lg px-3 py-2 max-w-[70%] bg-muted/10 min-w-0 break-words opacity-60 overflow-visible mr-1 mt-2">
        {/* Queue badge */}
        <div className="absolute -top-2 -left-2 flex items-center gap-1 bg-muted rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground z-10">
          <Clock className="h-2.5 w-2.5" />
          <span>#{index + 1}</span>
        </div>
        {/* Force send button - only on first queued message when session is idle */}
        {showForceSend && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleForceSend}
                className="absolute -top-2 -right-7 p-0.5 bg-muted hover:bg-green-600 text-muted-foreground hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <Play className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Force send now</TooltipContent>
          </Tooltip>
        )}
        {/* Remove button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleRemove}
              className="absolute -top-2 -right-2 p-0.5 bg-muted hover:bg-destructive text-muted-foreground hover:text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <X className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Remove from queue</TooltipContent>
        </Tooltip>
        {/* Attached images */}
        {message.pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1.5">
            {message.pendingImages.map((img, idx) => (
              <ImageLightbox
                key={`${message.id}-img-${idx}`}
                src={img.path}
                alt={`Attached image ${idx + 1}`}
                thumbnailClassName="h-20 max-w-40 object-contain rounded border border-border/50 cursor-pointer hover:border-primary/50 transition-colors"
              />
            ))}
          </div>
        )}
        {/* Attached text files */}
        {message.pendingTextFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1.5">
            {message.pendingTextFiles.map((tf, idx) => (
              <TextFileLightbox
                key={`${message.id}-txt-${idx}`}
                path={tf.path}
                size={tf.size}
              />
            ))}
          </div>
        )}
        {/* Attached file/directory mentions */}
        {message.pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1.5">
            {message.pendingFiles.map((f, idx) => (
              <FileMentionBadge
                key={`${message.id}-file-${idx}`}
                path={f.relativePath}
                worktreePath={worktreePath ?? ''}
                isDirectory={f.isDirectory}
              />
            ))}
          </div>
        )}
        {/* Attached skills */}
        {message.pendingSkills.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1.5">
            {message.pendingSkills.map((skill, idx) => {
              const parts = normalizePath(skill.path).split('/')
              const skillsIdx = parts.findIndex(p => p === 'skills')
              const name =
                skillsIdx >= 0 && parts[skillsIdx + 1]
                  ? parts[skillsIdx + 1]
                  : skill.name
              return (
                <SkillBadge
                  key={`${message.id}-skill-${idx}`}
                  skill={{
                    id: skill.id,
                    name: name ?? skill.name,
                    path: skill.path,
                  }}
                  compact
                />
              )
            })}
          </div>
        )}
        {/* Message content */}
        <div className="text-sm whitespace-pre-wrap">{message.message}</div>
        {/* Captured settings */}
        <div className="mt-1.5">
          <MessageSettingsBadges
            model={message.model}
            executionMode={message.executionMode}
            thinkingLevel={message.thinkingLevel}
            effortLevel={message.effortLevel}
            isCursor={message.backend === 'cursor'}
          />
        </div>
      </div>
    </div>
  )
})

interface QueuedMessagesListProps {
  messages: QueuedMessage[]
  sessionId: string
  worktreePath?: string
  onRemove: (sessionId: string, messageId: string) => void
  onForceSend?: (sessionId: string) => void
  isSessionIdle?: boolean
}

/**
 * List of queued messages
 * Memoized container that renders memoized items
 */
export const QueuedMessagesList = memo(function QueuedMessagesList({
  messages,
  sessionId,
  worktreePath,
  onRemove,
  onForceSend,
  isSessionIdle,
}: QueuedMessagesListProps) {
  if (messages.length === 0) return null

  return (
    <div className="space-y-3 mt-4 pr-2">
      {messages.map((msg, index) => (
        <QueuedMessageItem
          key={msg.id}
          message={msg}
          index={index}
          sessionId={sessionId}
          worktreePath={worktreePath}
          onRemove={onRemove}
          onForceSend={onForceSend}
          isSessionIdle={isSessionIdle}
        />
      ))}
    </div>
  )
})
