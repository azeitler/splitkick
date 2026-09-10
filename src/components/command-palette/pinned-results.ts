import { defaultFilter } from 'cmdk'

/**
 * Keyword that marks a palette row as pinned. cmdk hands each item's keywords
 * to the filter, which is how `paletteFilter` recognises a pinned row.
 */
export const PINNED_KEYWORD = '__pinned__'

/** The highest score cmdk understands. */
const TOP_SCORE = 1

/**
 * Palette filter: pinned rows always score the maximum, every other row is
 * scored by cmdk's own default.
 *
 * Rendering a group first is not enough to keep it first. While a query is
 * typed, cmdk re-sorts groups by their best item score, and its scorer docks a
 * small penalty for case mismatches, so a capitalised project name loses to any
 * lowercase value that starts the same way. Scores cap at 1 and the group sort
 * is stable, so a pinned group rendered first is guaranteed to stay first.
 */
export function paletteFilter(
  value: string,
  search: string,
  keywords?: string[]
): number {
  if (keywords?.includes(PINNED_KEYWORD)) return TOP_SCORE
  return defaultFilter(value, search, keywords)
}

export interface PinnableProject {
  label: string
}

/**
 * Projects to pin above every other Quick result: names that equal the query,
 * or start with it. Case-insensitive.
 *
 * Exact matches come first, so typing a full name puts that project on Enter.
 * Within each tier the incoming order is kept, so callers control recency.
 */
export function findPinnedProjects<T extends PinnableProject>(
  projects: T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const exact: T[] = []
  const prefix: T[] = []
  for (const project of projects) {
    const name = project.label.toLowerCase()
    if (name === needle) exact.push(project)
    else if (name.startsWith(needle)) prefix.push(project)
  }
  return [...exact, ...prefix]
}
