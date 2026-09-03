import type { LabelData } from '@/types/chat'
import { removeLabelFromLabels } from '@/lib/worktree-labels'

/** Built-in label names, always listed first. */
export const PRESET_LABELS = ['Needs testing']

export const DEFAULT_LABEL_COLOR = '#eab308'

export const LABEL_COLORS = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Yellow', value: DEFAULT_LABEL_COLOR },
  { name: 'Orange', value: '#f97316' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Gray', value: '#6b7280' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Lime', value: '#84cc16' },
]

export interface LabelSources {
  /** Session label registry (`useChatStore.sessionLabels`). */
  sessionLabels?: Record<string, LabelData>
  /** Extra known labels, e.g. every label used by the project's worktrees. */
  extraLabels?: LabelData[]
  /** Labels applied to the current target. These win over registry colors. */
  selected?: LabelData[]
  /** Local colour overrides for instant feedback before a refetch lands. */
  colorOverrides?: Record<string, string>
}

/**
 * Every selectable label name: presets first, then custom names sorted.
 *
 * Names are deduplicated case-insensitively, the same way the backend does it
 * (`dedupe_labels_by_name` in `jean-core/src/projects/types.rs`). Listing "Bug"
 * and "bug" as two rows would let you check both, and the backend would then
 * collapse them into one.
 */
export function getKnownLabelNames(sources: LabelSources): string[] {
  const presetKeys = new Set(PRESET_LABELS.map(name => name.toLowerCase()))
  const byKey = new Map<string, string>()

  const add = (name: string) => {
    const key = name.toLowerCase()
    if (presetKeys.has(key) || byKey.has(key)) return
    byKey.set(key, name)
  }

  for (const label of Object.values(sources.sessionLabels ?? {}))
    add(label.name)
  for (const label of sources.extraLabels ?? []) add(label.name)
  for (const label of sources.selected ?? []) add(label.name)

  return [
    ...PRESET_LABELS,
    ...[...byKey.values()].sort((a, b) => a.localeCompare(b)),
  ]
}

/**
 * Resolve the colour and pinned state for a label name.
 *
 * Precedence: colour override, then the applied label, then the session
 * registry, then the extra labels, then the default colour. A pinned entry in
 * `extraLabels` always marks the result as pinned.
 */
export function resolveLabelData(
  name: string,
  sources: LabelSources
): LabelData {
  const { sessionLabels, extraLabels, selected, colorOverrides } = sources

  const key = name.toLowerCase()
  const applied = selected?.find(label => label.name.toLowerCase() === key)
  const extra = extraLabels?.find(label => label.name.toLowerCase() === key)

  const override = colorOverrides?.[name]
  if (override) {
    return { ...(applied ?? { name }), color: override }
  }

  if (applied) {
    return extra?.pinned ? { ...applied, pinned: true } : applied
  }

  const existing = Object.values(sessionLabels ?? {}).find(
    label => label.name.toLowerCase() === key
  )
  if (existing) {
    return extra?.pinned ? { ...existing, pinned: true } : existing
  }

  if (extra) return extra

  return { name, color: DEFAULT_LABEL_COLOR }
}

/** Every selectable label, resolved. */
export function getKnownLabels(sources: LabelSources): LabelData[] {
  return getKnownLabelNames(sources).map(name =>
    resolveLabelData(name, sources)
  )
}

export function isLabelSelected(selected: LabelData[], name: string): boolean {
  const key = name.toLowerCase()
  return selected.some(label => label.name.toLowerCase() === key)
}

/** Add the label when it is absent, remove it when it is present. */
export function toggleLabelInList(
  selected: LabelData[],
  label: LabelData
): LabelData[] {
  return isLabelSelected(selected, label.name)
    ? removeLabelFromLabels(selected, label.name)
    : [...selected, label]
}
