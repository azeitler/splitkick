import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_COLOR,
  PRESET_LABELS,
  getKnownLabelNames,
  getKnownLabels,
  isLabelSelected,
  resolveLabelData,
  toggleLabelInList,
} from './labels'
import type { LabelData } from '@/types/chat'

const label = (name: string, color = '#111111', pinned?: boolean): LabelData =>
  pinned === undefined ? { name, color } : { name, color, pinned }

describe('getKnownLabelNames', () => {
  it('lists presets first, then custom names sorted', () => {
    expect(
      getKnownLabelNames({
        sessionLabels: { s1: label('Zebra'), s2: label('Apple') },
      })
    ).toEqual([...PRESET_LABELS, 'Apple', 'Zebra'])
  })

  it('does not duplicate a preset that is also assigned', () => {
    const names = getKnownLabelNames({
      sessionLabels: { s1: label('Needs testing') },
      extraLabels: [label('Needs testing')],
    })
    expect(names.filter(name => name === 'Needs testing')).toHaveLength(1)
  })

  it('unions session labels, extra labels and selected labels', () => {
    expect(
      getKnownLabelNames({
        sessionLabels: { s1: label('Alpha') },
        extraLabels: [label('Beta')],
        selected: [label('Gamma')],
      })
    ).toEqual([...PRESET_LABELS, 'Alpha', 'Beta', 'Gamma'])
  })

  it('dedupes names case-insensitively, keeping the first spelling', () => {
    // Matches the backend's dedupe_labels_by_name. Two rows for "Bug" and "bug"
    // would both be checkable, and the backend would collapse them into one.
    expect(
      getKnownLabelNames({
        sessionLabels: { s1: label('Bug') },
        extraLabels: [label('bug')],
      })
    ).toEqual([...PRESET_LABELS, 'Bug'])
  })

  it('does not duplicate a preset spelled with a different case', () => {
    expect(
      getKnownLabelNames({ sessionLabels: { s1: label('needs testing') } })
    ).toEqual([...PRESET_LABELS])
  })

  it('returns only the presets with no sources', () => {
    expect(getKnownLabelNames({})).toEqual([...PRESET_LABELS])
  })
})

describe('resolveLabelData', () => {
  it('prefers a colour override over everything else', () => {
    expect(
      resolveLabelData('Bug', {
        selected: [label('Bug', '#aaaaaa')],
        colorOverrides: { Bug: '#ff0000' },
      })
    ).toEqual({ name: 'Bug', color: '#ff0000' })
  })

  it('prefers the applied label over the session registry', () => {
    expect(
      resolveLabelData('Bug', {
        sessionLabels: { s1: label('Bug', '#111111') },
        selected: [label('Bug', '#222222')],
      })
    ).toEqual({ name: 'Bug', color: '#222222' })
  })

  it('merges pinned state from extraLabels onto an applied label', () => {
    expect(
      resolveLabelData('Bug', {
        selected: [label('Bug', '#222222')],
        extraLabels: [label('Bug', '#333333', true)],
      })
    ).toEqual({ name: 'Bug', color: '#222222', pinned: true })
  })

  it('merges pinned state from extraLabels onto a session label', () => {
    expect(
      resolveLabelData('Bug', {
        sessionLabels: { s1: label('Bug', '#111111') },
        extraLabels: [label('Bug', '#333333', true)],
      })
    ).toEqual({ name: 'Bug', color: '#111111', pinned: true })
  })

  it('falls back to the session registry', () => {
    expect(
      resolveLabelData('Bug', {
        sessionLabels: { s1: label('Bug', '#111111') },
      })
    ).toEqual({ name: 'Bug', color: '#111111' })
  })

  it('falls back to extraLabels', () => {
    expect(
      resolveLabelData('Bug', { extraLabels: [label('Bug', '#333333')] })
    ).toEqual({ name: 'Bug', color: '#333333' })
  })

  it('falls back to the default colour for an unknown name', () => {
    expect(resolveLabelData('Needs testing', {})).toEqual({
      name: 'Needs testing',
      color: DEFAULT_LABEL_COLOR,
    })
  })
})

describe('getKnownLabels', () => {
  it('resolves every known name', () => {
    expect(
      getKnownLabels({
        sessionLabels: { s1: label('Bug', '#111111') },
        selected: [label('Bug', '#222222')],
      })
    ).toEqual([
      { name: 'Needs testing', color: DEFAULT_LABEL_COLOR },
      { name: 'Bug', color: '#222222' },
    ])
  })
})

describe('isLabelSelected', () => {
  it('matches by name, ignoring case', () => {
    expect(isLabelSelected([label('Bug')], 'Bug')).toBe(true)
    expect(isLabelSelected([label('Bug')], 'bug')).toBe(true)
    expect(isLabelSelected([], 'Bug')).toBe(false)
  })
})

describe('toggleLabelInList', () => {
  it('adds a label that is absent', () => {
    expect(toggleLabelInList([label('Bug')], label('Chore'))).toEqual([
      label('Bug'),
      label('Chore'),
    ])
  })

  it('removes a label that is present', () => {
    expect(
      toggleLabelInList([label('Bug'), label('Chore')], label('Bug'))
    ).toEqual([label('Chore')])
  })

  it('removes case-insensitively, matching the backend dedupe', () => {
    expect(toggleLabelInList([label('Bug')], label('bug', '#999999'))).toEqual(
      []
    )
  })

  it('does not mutate the input', () => {
    const selected = [label('Bug')]
    toggleLabelInList(selected, label('Chore'))
    expect(selected).toEqual([label('Bug')])
  })
})
