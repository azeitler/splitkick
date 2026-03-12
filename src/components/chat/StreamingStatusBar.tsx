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
 * Always-mounted status bar for streaming progress / restored-running indicator.
 * Uses h-0 + overflow-hidden when not visible so it takes zero space without mount/unmount flicker.
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

  return (
    <span
      className={
        visible
          ? 'mt-1 block min-h-4 text-xs leading-4 text-muted-foreground/40 tabular-nums font-mono select-none'
          : 'h-0 overflow-hidden block'
      }
    >
      {showRestored ? (
        <span className="animate-dots">
          {getModeLabel(restoredExecutionMode)}
        </span>
      ) : (
        <>
          {getModeLabel(streamingExecutionMode)} for {elapsed ?? '0s'}
        </>
      )}
    </span>
  )
})
