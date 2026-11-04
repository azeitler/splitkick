import type { GraphChange, GraphDetail } from '@/types/graphs'

/**
 * Props every tab of `GraphView` gets (Outline, Dependencies, Review). A tab
 * reads the graph from `detail` and selects a node through `onSelectNode`,
 * which opens the node detail panel on the right.
 */
export interface GraphTabProps {
  graphId: string
  detail: GraphDetail
  /** Change log, newest first (undefined while loading). */
  changes: GraphChange[] | undefined
  /** Node ids with changes the user has not seen. */
  unseenNodeIds: ReadonlySet<string>
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
}
