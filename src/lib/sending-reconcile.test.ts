import { describe, expect, it } from 'vitest'
import {
  reconcileSendingState,
  SENDING_RECONCILE_GRACE_MS,
} from './sending-reconcile'

const NOW = 1_000_000
const OLD = NOW - SENDING_RECONCILE_GRACE_MS - 1
const FRESH = NOW - 1_000

describe('reconcileSendingState (#163)', () => {
  it('keeps a mark the host confirms', () => {
    expect(
      reconcileSendingState({
        hostIds: ['s1'],
        sendingBefore: { s1: true },
        sendingNow: { s1: true },
        sendStartedAt: { s1: OLD },
        finishedAt: {},
        now: NOW,
      })
    ).toEqual({ clear: [], add: [] })
  })

  it('clears a mark the host does not confirm', () => {
    expect(
      reconcileSendingState({
        hostIds: [],
        sendingBefore: { s1: true },
        sendingNow: { s1: true },
        sendStartedAt: { s1: OLD },
        finishedAt: {},
        now: NOW,
      })
    ).toEqual({ clear: ['s1'], add: [] })
  })

  it('clears a mark without a start time', () => {
    expect(
      reconcileSendingState({
        hostIds: [],
        sendingBefore: { s1: true },
        sendingNow: { s1: true },
        sendStartedAt: {},
        finishedAt: {},
        now: NOW,
      }).clear
    ).toEqual(['s1'])
  })

  it('keeps a send that just started in this client', () => {
    expect(
      reconcileSendingState({
        hostIds: [],
        sendingBefore: { s1: true },
        sendingNow: { s1: true },
        sendStartedAt: { s1: FRESH },
        finishedAt: {},
        now: NOW,
      })
    ).toEqual({ clear: [], add: [] })
  })

  it('keeps a mark set while the request was in flight', () => {
    expect(
      reconcileSendingState({
        hostIds: [],
        sendingBefore: {},
        sendingNow: { s1: true },
        sendStartedAt: { s1: OLD },
        finishedAt: {},
        now: NOW,
      }).clear
    ).toEqual([])
  })

  it('sets a missing mark for a session the host runs', () => {
    expect(
      reconcileSendingState({
        hostIds: ['s2'],
        sendingBefore: {},
        sendingNow: {},
        sendStartedAt: {},
        finishedAt: {},
        now: NOW,
      })
    ).toEqual({ clear: [], add: ['s2'] })
  })

  it('does not set a mark for a run that just ended in this client', () => {
    expect(
      reconcileSendingState({
        hostIds: ['s2'],
        sendingBefore: {},
        sendingNow: {},
        sendStartedAt: {},
        finishedAt: { s2: FRESH },
        now: NOW,
      }).add
    ).toEqual([])
  })

  it('does not set a mark that ended while the request was in flight', () => {
    expect(
      reconcileSendingState({
        hostIds: ['s2'],
        sendingBefore: { s2: true },
        sendingNow: {},
        sendStartedAt: {},
        finishedAt: {},
        now: NOW,
      }).add
    ).toEqual([])
  })
})
