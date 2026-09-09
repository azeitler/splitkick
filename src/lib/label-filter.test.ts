import { describe, it, expect } from 'vitest'
import {
  collectLabelOptions,
  createLabelFilter,
  isLabelFilterActive,
  matchesLabelFilter,
  pruneLabelFilter,
  sessionMatchesLabelFilter,
  toggleLabelFilter,
  worktreeMatchesLabelFilter,
} from './label-filter'
import type { LabelData, Session } from '@/types/chat'
import type { Worktree } from '@/types/projects'

const bug: LabelData = { name: 'Bug', color: '#ef4444' }
const testing: LabelData = { name: 'Needs testing', color: '#eab308' }

function session(label?: LabelData): Session {
  return { id: 's1', label } as unknown as Session
}

function worktree(labels: LabelData[]): Worktree {
  return { labels } as unknown as Worktree
}

describe('createLabelFilter', () => {
  it('lower-cases every name so matching ignores case', () => {
    const filter = createLabelFilter(['Bug', 'NEEDS TESTING'])
    expect([...filter]).toEqual(['bug', 'needs testing'])
  })
})

describe('toggleLabelFilter', () => {
  it('adds a missing name and removes a present one', () => {
    let filter = createLabelFilter([])
    filter = toggleLabelFilter(filter, 'Bug')
    expect(isLabelFilterActive(filter)).toBe(true)

    filter = toggleLabelFilter(filter, 'bug')
    expect(isLabelFilterActive(filter)).toBe(false)
  })

  it('returns a new set, so React sees the change', () => {
    const filter = createLabelFilter(['bug'])
    expect(toggleLabelFilter(filter, 'other')).not.toBe(filter)
  })
})

describe('matchesLabelFilter', () => {
  it('matches everything when nothing is selected', () => {
    expect(matchesLabelFilter([], createLabelFilter([]))).toBe(true)
  })

  it('matches when any label is selected', () => {
    const filter = createLabelFilter(['bug'])
    expect(matchesLabelFilter([testing, bug], filter)).toBe(true)
    expect(matchesLabelFilter([testing], filter)).toBe(false)
  })

  it('rejects an unlabelled item while a filter is active', () => {
    expect(matchesLabelFilter([], createLabelFilter(['bug']))).toBe(false)
  })
})

describe('sessionMatchesLabelFilter', () => {
  it('uses the persisted label', () => {
    expect(
      sessionMatchesLabelFilter(session(bug), createLabelFilter(['bug']))
    ).toBe(true)
  })

  it('lets an unsaved store label win over the persisted one', () => {
    const filter = createLabelFilter(['needs testing'])
    expect(sessionMatchesLabelFilter(session(bug), filter, testing)).toBe(true)
    expect(sessionMatchesLabelFilter(session(bug), filter)).toBe(false)
  })
})

describe('worktreeMatchesLabelFilter', () => {
  it('matches any of the worktree labels', () => {
    expect(
      worktreeMatchesLabelFilter(
        worktree([testing, bug]),
        createLabelFilter(['bug'])
      )
    ).toBe(true)
  })
})

describe('collectLabelOptions', () => {
  it('counts each label once per item and sorts by count then name', () => {
    const options = collectLabelOptions([
      [bug, { name: 'bug', color: '#000000' }],
      [bug],
      [testing],
    ])

    expect(options.map(option => [option.name, option.count])).toEqual([
      ['Bug', 2],
      ['Needs testing', 1],
    ])
  })

  it('keeps the first colour seen for a name', () => {
    const options = collectLabelOptions([[bug], [{ name: 'BUG', color: '#fff' }]])
    expect(options).toHaveLength(1)
    expect(options[0]?.color).toBe(bug.color)
  })

  it('falls back to the default colour when a label has none', () => {
    const options = collectLabelOptions([[{ name: 'Bare' } as LabelData]])
    expect(options[0]?.color).toBe('#eab308')
  })
})

describe('pruneLabelFilter', () => {
  it('drops a selection no item carries any more', () => {
    const pruned = pruneLabelFilter(
      createLabelFilter(['bug', 'gone']),
      collectLabelOptions([[bug]])
    )
    expect([...pruned]).toEqual(['bug'])
  })

  it('returns the same set when nothing changed', () => {
    const filter = createLabelFilter(['bug'])
    expect(pruneLabelFilter(filter, collectLabelOptions([[bug]]))).toBe(filter)
  })

  it('returns an empty filter untouched', () => {
    const filter = createLabelFilter([])
    expect(pruneLabelFilter(filter, [])).toBe(filter)
  })
})
