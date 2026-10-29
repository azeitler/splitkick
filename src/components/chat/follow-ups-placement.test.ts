import { describe, expect, it } from 'vitest'
import {
  FOLLOW_UPS_PANEL_GAP,
  FOLLOW_UPS_PANEL_WIDTH,
  getFollowUpsPlacement,
} from './follow-ups-placement'

describe('getFollowUpsPlacement', () => {
  const panelWidth = 320
  const gap = 12

  it('opens beside the column when the right-hand side space fits the panel', () => {
    // (1600 - 896) / 2 = 352 >= 320 + 2 * 12
    expect(
      getFollowUpsPlacement({
        containerWidth: 1600,
        columnWidth: 896,
        panelWidth,
        gap,
      })
    ).toBe('beside')
  })

  it('opens above the composer when the side space is too narrow', () => {
    // (1180 - 896) / 2 = 142 < 344
    expect(
      getFollowUpsPlacement({
        containerWidth: 1180,
        columnWidth: 896,
        panelWidth,
        gap,
      })
    ).toBe('above')
  })

  it('needs a gap on both sides of the panel', () => {
    expect(
      getFollowUpsPlacement({
        containerWidth: 896 + 2 * (panelWidth + 2 * gap),
        columnWidth: 896,
        panelWidth,
        gap,
      })
    ).toBe('beside')
    expect(
      getFollowUpsPlacement({
        containerWidth: 896 + 2 * (panelWidth + 2 * gap) - 1,
        columnWidth: 896,
        panelWidth,
        gap,
      })
    ).toBe('above')
  })

  it('opens above when nothing is measured yet', () => {
    expect(
      getFollowUpsPlacement({
        containerWidth: 0,
        columnWidth: 0,
        panelWidth,
        gap,
      })
    ).toBe('above')
  })

  it('defaults to the panel size used in the markup (w-80, ml-3)', () => {
    expect(FOLLOW_UPS_PANEL_WIDTH).toBe(320)
    expect(FOLLOW_UPS_PANEL_GAP).toBe(12)
    expect(
      getFollowUpsPlacement({ containerWidth: 1584, columnWidth: 896 })
    ).toBe('beside')
    expect(
      getFollowUpsPlacement({ containerWidth: 1583, columnWidth: 896 })
    ).toBe('above')
  })
})
