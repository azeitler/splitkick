import { describe, expect, it } from 'vitest'
import type { Session } from '@/types/chat'
import { getRecentSessionStatus } from './recent-session-status'

const session = (values: Partial<Session> = {}): Session =>
  ({
    id: 'session',
    name: 'Session',
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...values,
  }) as Session

describe('getRecentSessionStatus', () => {
  it('uses waiting, working, and failed priority before execution mode', () => {
    expect(
      getRecentSessionStatus(session({ last_run_status: 'crashed' }), {
        sending: true,
        waiting: true,
        executionMode: 'yolo',
      }).label
    ).toBe('Waiting')
    expect(
      getRecentSessionStatus(session({ last_run_status: 'crashed' }), {
        sending: true,
        waiting: false,
      }).label
    ).toBe('Working')
    expect(
      getRecentSessionStatus(session({ last_run_status: 'crashed' }), {
        sending: false,
        waiting: false,
      }).label
    ).toBe('Failed')
  })

  it.each([
    ['plan', 'Plan'],
    ['build', 'Build'],
    ['yolo', 'Yolo'],
  ] as const)('shows %s as %s when idle', (mode, label) => {
    expect(
      getRecentSessionStatus(session(), {
        sending: false,
        waiting: false,
        executionMode: mode,
      }).label
    ).toBe(label)
  })

  it('treats persisted running and resumable runs as working', () => {
    for (const status of ['running', 'resumable'] as const) {
      expect(
        getRecentSessionStatus(session({ last_run_status: status }), {
          sending: false,
          waiting: false,
        }).label
      ).toBe('Working')
    }
  })
})
