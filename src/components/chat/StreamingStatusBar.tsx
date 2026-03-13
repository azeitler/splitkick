import { memo } from 'react'
import type { ExecutionMode, RunStatus } from '@/types/chat'
import { useElapsedTime } from './hooks/useElapsedTime'

interface StreamingStatusBarProps {
  isSending: boolean
  sendStartedAt: number | null
  streamingExecutionMode: ExecutionMode
  restoredRunStatus?: RunStatus
  restoredExecutionMode?: string
}

function getModeLabel(mode: string | undefined): string {
  if (mode === 'plan') return 'Planning'
  if (mode === 'yolo') return 'Yoloing'
  return 'Vibing'
}

/**
 * Inline streaming timer shown after the last response message.
 * Returns null when not visible.
 */
export const StreamingStatusBar = memo(function StreamingStatusBar({
  isSending,
  sendStartedAt,
  streamingExecutionMode,
  restoredRunStatus,
  restoredExecutionMode,
}: StreamingStatusBarProps) {
  const elapsed = useElapsedTime(isSending ? sendStartedAt : null)

  const showRestored = !isSending && restoredRunStatus === 'running'
  const visible = isSending || showRestored

  if (!visible) return null

  return (
    <div className="my-1">
      <span className="text-xs leading-4 text-yellow-500 tabular-nums font-mono select-none">
        {showRestored ? (
          <span className="animate-dots">
            {getModeLabel(restoredExecutionMode)}
          </span>
        ) : (
          <>
            {getModeLabel(streamingExecutionMode)} for {elapsed ?? '0s'}...
          </>
        )}
      </span>
    </div>
  )
})
