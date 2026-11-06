import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChangeSessionServes, useGraph, useGraphs } from '@/services/graphs'
import { parseGraphRef } from './graph-utils'
import { ServesPicker } from './ServesPicker'

interface ServesEditorProps {
  sessionId: string
  /** The session's current refs. */
  serves: string[]
  /** Called with the resulting list after each saved change. */
  onChange?: (serves: string[]) => void
}

/** "Graph › Node", or "Graph (whole graph)". */
function useRefLabel(ref: string): string {
  const { graphId, nodeId } = parseGraphRef(ref)
  const { data: graphs } = useGraphs()
  const { data: detail } = useGraph(nodeId ? graphId : null)
  const title = graphs?.find(g => g.id === graphId)?.title ?? graphId
  if (!nodeId) return `${title} (whole graph)`
  const node = detail?.nodes.find(n => n.id === nodeId)
  return `${title} › ${node?.title ?? nodeId}`
}

function ServesChip({
  value,
  onRemove,
}: {
  value: string
  onRemove: () => void
}) {
  const label = useRefLabel(value)
  return (
    <li className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
      {label}
      <button
        type="button"
        aria-label={`Stop serving ${label}`}
        className="text-muted-foreground hover:text-foreground"
        onClick={onRemove}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </li>
  )
}

/**
 * List and edit what a session serves (#88). Used by the session graph panel
 * and the "Link to Graph…" dialog. Saves add/remove changes, so an edit here
 * never overwrites a ref an agent set meanwhile.
 */
export function ServesEditor({
  sessionId,
  serves,
  onChange,
}: ServesEditorProps) {
  const change = useChangeSessionServes()
  const [adding, setAdding] = useState<string | null>(null)

  const save = (args: { add?: string[]; remove?: string[] }) =>
    change.mutate(
      { sessionId, ...args },
      { onSuccess: next => onChange?.(next) }
    )

  return (
    <div>
      {serves.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Not linked to a graph yet.
        </p>
      ) : (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Graph links">
          {serves.map(ref => (
            <ServesChip
              key={ref}
              value={ref}
              onRemove={() => save({ remove: [ref] })}
            />
          ))}
        </ul>
      )}
      {adding === null ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-ml-2"
          onClick={() => setAdding('')}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <ServesPicker value={adding} onChange={setAdding} />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!adding || serves.includes(adding) || change.isPending}
              onClick={() => {
                if (adding) save({ add: [adding] })
                setAdding(null)
              }}
            >
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
