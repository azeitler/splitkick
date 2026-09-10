import { defaultFilter } from 'cmdk'
import { describe, expect, it } from 'vitest'
import {
  PINNED_KEYWORD,
  findPinnedProjects,
  paletteFilter,
} from './pinned-results'

const projects = [
  { id: 'recent', label: 'Jean-docs' },
  { id: 'exact', label: 'Jean' },
  { id: 'older', label: 'JeanZ' },
  { id: 'unrelated', label: 'Coolify' },
  { id: 'infix', label: 'Mr Jean' },
]

const ids = (list: { id: string }[]) => list.map(project => project.id)

describe('findPinnedProjects', () => {
  it('pins nothing for an empty query', () => {
    expect(findPinnedProjects(projects, '   ')).toEqual([])
  })

  it('pins projects whose name starts with the query, ignoring case', () => {
    expect(ids(findPinnedProjects(projects, 'jEA'))).toEqual([
      'recent',
      'exact',
      'older',
    ])
  })

  it('puts an exact match first, even when it was accessed less recently', () => {
    expect(ids(findPinnedProjects(projects, 'jean'))).toEqual([
      'exact',
      'recent',
      'older',
    ])
  })

  it('keeps the incoming order within a tier', () => {
    // Callers pass projects most-recent first; that order must survive.
    expect(ids(findPinnedProjects(projects, 'jean-'))).toEqual(['recent'])
    expect(ids(findPinnedProjects(projects, 'je'))).toEqual([
      'recent',
      'exact',
      'older',
    ])
  })

  it('does not pin a match in the middle of a name', () => {
    // "Mr Jean" contains the query but does not start with it.
    expect(ids(findPinnedProjects(projects, 'jean'))).not.toContain('infix')
  })

  it('trims the query before matching', () => {
    expect(ids(findPinnedProjects(projects, '  coolify  '))).toEqual([
      'unrelated',
    ])
  })
})

describe('paletteFilter', () => {
  it('gives a pinned row the top score, whatever the query', () => {
    expect(paletteFilter('anything', 'zzz', [PINNED_KEYWORD])).toBe(1)
  })

  it('scores every other row exactly as cmdk would', () => {
    const cases: [string, string, string[] | undefined][] = [
      ['add-project Add Project', 'add', undefined],
      ['Jean Open project', 'jea', ['project']],
      ['deploy pipeline', 'zzz', undefined],
    ]
    for (const [value, search, keywords] of cases) {
      expect(paletteFilter(value, search, keywords)).toBe(
        defaultFilter(value, search, keywords)
      )
    }
  })

  it('outranks a lowercase row that would otherwise beat a capitalised project', () => {
    // The reason the pin exists: cmdk's scorer penalises the case mismatch on
    // "Jean", so a lowercase value starting "jea" scores higher by default.
    const project = 'Jean Open project switch open jean'
    const competitor = 'jean-docs-open jean docs'

    expect(defaultFilter(competitor, 'jea')).toBeGreaterThan(
      defaultFilter(project, 'jea')
    )
    expect(paletteFilter(project, 'jea', [PINNED_KEYWORD])).toBeGreaterThan(
      paletteFilter(competitor, 'jea')
    )
  })
})
