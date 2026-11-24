import { memo } from 'react'
import type { ExecutionMode, RunStatus } from '@/types/chat'
import {
  StatusIndicator,
  type IndicatorVariant,
} from '@/components/ui/status-indicator'
import { useElapsedTime } from './hooks/useElapsedTime'

interface StreamingStatusBarProps {
  isSending: boolean
  sendStartedAt: number | null
  streamingExecutionMode: ExecutionMode
  restoredRunStatus?: RunStatus
  restoredExecutionMode?: string
  /**
   * The live run waits for an answer to a question or plan: nothing runs,
   * so no timer counts.
   */
  awaitingAnswer?: boolean
}

function getModeLabel(mode: string | undefined): string {
  if (mode === 'plan') return 'Planning'
  if (mode === 'yolo') return 'Yoloing'
  return 'Vibing'
}

function getSpinnerVariant(
  mode: ExecutionMode | string | undefined
): IndicatorVariant | undefined {
  return mode === 'yolo' ? 'destructive' : undefined
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
  awaitingAnswer = false,
}: StreamingStatusBarProps) {
  const elapsed = useElapsedTime(
    isSending && !awaitingAnswer ? sendStartedAt : null
  )

  const showRestored = !isSending && restoredRunStatus === 'running'
  const visible = isSending || showRestored
  const activeMode = isSending ? streamingExecutionMode : restoredExecutionMode

  if (!visible || awaitingAnswer) return null

  return (
    <div
      data-testid="streaming-status-bar"
      className="mt-1 inline-flex min-h-4 items-center gap-1.5 text-xs text-muted-foreground/40 tabular-nums font-mono select-none">
      <StatusIndicator
        status="running"
        variant={getSpinnerVariant(activeMode)}
        className="h-2 w-2"
      />
      {showRestored ? (
        <span className="leading-none animate-dots">
          {getModeLabel(restoredExecutionMode)}
        </span>
      ) : (
        <span className="leading-none">{elapsed ?? '0s'}</span>
      )}
    </div>
  )
})
