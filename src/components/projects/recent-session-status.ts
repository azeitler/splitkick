import type { Session } from '@/types/chat'

export type RecentSessionStatus =
  | { label: 'Waiting'; tone: 'waiting' }
  | { label: 'Working'; tone: 'working' }
  | { label: 'Failed'; tone: 'failed' }
  | {
      label: 'Idle' | 'Review' | 'Completed' | 'Cancelled'
      tone: 'idle'
    }

export function getRecentSessionStatus(
  session: Session,
  state: {
    sending: boolean
    waiting: boolean
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
  if (session.status_override === 'review' || session.is_reviewing) {
    return { label: 'Review', tone: 'idle' }
  }
  if (session.status_override === 'completed') {
    return { label: 'Completed', tone: 'idle' }
  }
  if (
    session.status_override === 'cancelled' ||
    session.last_run_status === 'cancelled'
  ) {
    return { label: 'Cancelled', tone: 'idle' }
  }
  if (session.last_run_status === 'completed') {
    return { label: 'Completed', tone: 'idle' }
  }
  return { label: 'Idle', tone: 'idle' }
}
