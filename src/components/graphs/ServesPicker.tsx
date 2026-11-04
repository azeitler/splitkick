import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useGraph, useGraphs } from '@/services/graphs'
import { graphRef, parseGraphRef } from './graph-utils'

interface ServesPickerProps {
  /** Graph ref, or '' for "nothing". */
  value: string
  onChange: (ref: string) => void
  /** Offer "nothing" as the first graph option. */
  allowNone?: boolean
}

/**
 * Pick what a session serves: a graph, then the whole graph or one node.
 * Value and result are graph refs (`<graph-id>` or `<graph-id>#<node-id>`).
 */
export function ServesPicker({
  value,
  onChange,
  allowNone,
}: ServesPickerProps) {
  const { data: graphs } = useGraphs()
  const { graphId, nodeId } = value
    ? parseGraphRef(value)
    : { graphId: '', nodeId: null }
  const { data: detail } = useGraph(graphId || null)

  return (
    <div className="flex flex-wrap gap-2">
      <NativeSelect
        aria-label="Serves graph"
        value={graphId}
        onChange={e => onChange(e.target.value)}
        className="min-w-44"
      >
        {(allowNone || !graphId) && (
          <NativeSelectOption value="">
            {allowNone ? 'Nothing' : 'Pick a graph'}
          </NativeSelectOption>
        )}
        {(graphs ?? []).map(graph => (
          <NativeSelectOption key={graph.id} value={graph.id}>
            {graph.title}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {graphId && (
        <NativeSelect
          aria-label="Serves node"
          value={nodeId ?? ''}
          onChange={e => onChange(graphRef(graphId, e.target.value || null))}
          className="min-w-44"
        >
          <NativeSelectOption value="">(whole graph)</NativeSelectOption>
          {(detail?.nodes ?? []).map(node => (
            <NativeSelectOption key={node.id} value={node.id}>
              {node.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </div>
  )
}
