import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { useProjectsStore } from '@/store/projects-store'

/**
 * Graph detail panels show a simple layer, then two foldouts below it:
 * "Relationships" and "Show details" (the expert layer). Each is one saved
 * choice for every panel (`graph_relations_shown`, `graph_details_shown`).
 */
export function useGraphDetailsShown(): boolean {
  return useProjectsStore(state => state.graphDetailsShown)
}

export function useGraphRelationsShown(): boolean {
  return useProjectsStore(state => state.graphRelationsShown)
}

const ROW =
  'flex w-full items-center gap-1 border-b px-4 py-2 text-left text-xs text-muted-foreground hover:text-foreground'

export function GraphDetailsToggle() {
  const shown = useGraphDetailsShown()
  const Icon = shown ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      data-testid="graph-details-toggle"
      aria-expanded={shown}
      onClick={() => useProjectsStore.getState().setGraphDetailsShown(!shown)}
      className={ROW}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {shown ? 'Hide details' : 'Show details'}
    </button>
  )
}

/** Header of the Relationships foldout; `count` shows next to the label. */
export function GraphRelationsToggle({ count }: { count: number }) {
  const shown = useGraphRelationsShown()
  const Icon = shown ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      data-testid="graph-relations-toggle"
      aria-expanded={shown}
      onClick={() => useProjectsStore.getState().setGraphRelationsShown(!shown)}
      className={ROW}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      Relationships
      <span className="tabular-nums">({count})</span>
    </button>
  )
}
