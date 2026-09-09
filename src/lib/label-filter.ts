/**
 * One label matcher for every surface that filters by label.
 *
 * Home, the sidebar, and the project canvas all filter the same way: a set of
 * selected label names, matched case-insensitively, with an empty set meaning
 * "show everything". Keeping the rule here stops the three surfaces from
 * drifting apart.
 *
 * Names are compared in lower case because the backend deduplicates labels the
 * same way (`dedupe_labels_by_name` in `jean-core/src/projects/types.rs`).
 */

import type { LabelData, Session } from '@/types/chat'
import type { Worktree } from '@/types/projects'
import { getWorktreeLabels } from '@/lib/worktree-labels'
import { DEFAULT_LABEL_COLOR } from '@/lib/labels'

/** Selected label names, in lower case. An empty set matches everything. */
export type LabelFilter = ReadonlySet<string>

export const EMPTY_LABEL_FILTER: LabelFilter = new Set<string>()

/** Build a filter from the names the user picked. */
export function createLabelFilter(names: Iterable<string>): LabelFilter {
  return new Set(Array.from(names, name => name.toLowerCase()))
}

/** Add the name when it is absent, remove it when it is present. */
export function toggleLabelFilter(
  filter: LabelFilter,
  name: string
): LabelFilter {
  const key = name.toLowerCase()
  const next = new Set(filter)
  if (!next.delete(key)) next.add(key)
  return next
}

export function isLabelFilterActive(filter: LabelFilter): boolean {
  return filter.size > 0
}

/** True when any of `labels` is selected, or when no label is selected. */
export function matchesLabelFilter(
  labels: readonly LabelData[],
  filter: LabelFilter
): boolean {
  if (filter.size === 0) return true
  return labels.some(label => filter.has(label.name.toLowerCase()))
}

/** A session carries at most one label. */
export function sessionMatchesLabelFilter(
  session: Pick<Session, 'label'>,
  filter: LabelFilter,
  /** Unsaved labels from the chat store, keyed by session id. */
  storeLabel?: LabelData
): boolean {
  const label = storeLabel ?? session.label
  return matchesLabelFilter(label ? [label] : [], filter)
}

/** A worktree can carry several labels. */
export function worktreeMatchesLabelFilter(
  worktree: Pick<Worktree, 'labels' | 'label'>,
  filter: LabelFilter
): boolean {
  return matchesLabelFilter(getWorktreeLabels(worktree), filter)
}

export interface LabelFilterOption extends LabelData {
  /** How many of the given items carry this label. */
  count: number
}

/**
 * The labels present in a list, with counts, sorted by count then name.
 *
 * The first colour seen for a name wins, so a chip keeps one colour even when
 * two records disagree.
 */
export function collectLabelOptions(
  labelsPerItem: Iterable<readonly LabelData[]>
): LabelFilterOption[] {
  const byKey = new Map<string, LabelFilterOption>()

  for (const labels of labelsPerItem) {
    // One item must not count the same label twice.
    const seen = new Set<string>()
    for (const label of labels) {
      const key = label.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
      } else {
        byKey.set(key, {
          name: label.name,
          color: label.color || DEFAULT_LABEL_COLOR,
          pinned: label.pinned,
          count: 1,
        })
      }
    }
  }

  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  )
}

/**
 * Drop selections that no longer exist, so a stale chip cannot hide every row.
 * Returns the same object when nothing changed, to keep React state stable.
 */
export function pruneLabelFilter(
  filter: LabelFilter,
  options: readonly LabelFilterOption[]
): LabelFilter {
  if (filter.size === 0) return filter
  const available = new Set(options.map(option => option.name.toLowerCase()))
  const kept = [...filter].filter(name => available.has(name))
  return kept.length === filter.size ? filter : new Set(kept)
}
