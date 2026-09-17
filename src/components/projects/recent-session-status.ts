import type { ExecutionMode, Session } from '@/types/chat'

export type RecentSessionStatus =
  | { label: 'Waiting'; tone: 'waiting' }
  | { label: 'Working'; tone: 'working' }
  | { label: 'Failed'; tone: 'failed' }
  | { label: 'Plan' | 'Build' | 'Yolo'; tone: 'mode' }

export function getRecentSessionStatus(
  session: Session,
  state: {
    sending: boolean
    waiting: boolean
    executionMode?: ExecutionMode
    executingMode?: ExecutionMode
  }
): RecentSessionStatus {
  if (state.waiting || session.waiting_for_input) {
    return { label: 'Waiting', tone: 'waiting' }
  }
  if (
    state.sending ||
    session.last_run_status === 'running' ||
    session.last_run_status === 'resumable'
  ) {
    return { label: 'Working', tone: 'working' }
  }
  if (session.last_run_status === 'crashed') {
    return { label: 'Failed', tone: 'failed' }
  }
  const mode =
    state.executingMode ??
    state.executionMode ??
    session.selected_execution_mode ??
    session.last_run_execution_mode ??
    'plan'
  return {
    label: mode === 'yolo' ? 'Yolo' : mode === 'build' ? 'Build' : 'Plan',
    tone: 'mode',
  }
}
