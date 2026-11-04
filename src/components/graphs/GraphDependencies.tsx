import { useMemo } from 'react'
import { ArrowUpRight, Ban, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NodeState } from '@/types/graphs'
import type { GraphTabProps } from './graph-tab'
import { issueNumber } from './graph-utils'
import {
  buildDependencyLayout,
  DECISION_COLUMN,
  type DependencyBar,
  type DependencyLayout,
} from './dependency-layout'

const LABEL_W = 140
const COL_W = 220
const BAR_W = 196
const BAR_H = 44
const ROW_H = 56
const LANE_PAD = 14
const HEADER_H = 28

const STRIPE: Record<NodeState, string> = {
  proposed: 'border-l-muted-foreground/40',
  committed: 'border-l-blue-500',
  done: 'border-l-green-500',
  dropped: 'border-l-muted-foreground/20',
}

const RED = '#ef4444'
const GREY = '#9ca3af'
const BLUE = '#3b82f6'

interface Geometry {
  laneTop: number[]
  height: number
  width: number
}

function geometry(layout: DependencyLayout): Geometry {
  const laneTop: number[] = []
  let y = HEADER_H
  for (const lane of layout.lanes) {
    laneTop.push(y)
    y += lane.rows * ROW_H + LANE_PAD * 2
  }
  return { laneTop, height: y, width: LABEL_W + layout.columns * COL_W }
}

const colX = (column: number) => LABEL_W + column * COL_W + 8
const rowY = (geo: Geometry, lane: number, row: number) =>
  (geo.laneTop[lane] ?? 0) + LANE_PAD + row * ROW_H

/**
 * Dependencies tab (mockup screen 2b): a Gantt-like grid. Columns are
 * dependency steps, not dates; lanes are `part-of` groups. Layout:
 * `dependency-layout.ts`.
 */
export function GraphDependencies({
  detail,
  selectedNodeId,
  onSelectNode,
}: GraphTabProps) {
  const layout = useMemo(() => buildDependencyLayout(detail), [detail])
  const geo = useMemo(() => geometry(layout), [layout])
  const barByKey = useMemo(
    () => new Map(layout.bars.map(bar => [bar.key, bar])),
    [layout]
  )

  if (layout.bars.length === 0 && layout.decisions.length === 0) {
    return (
      <div
        className="px-6 py-8 text-sm text-muted-foreground"
        data-testid="graph-dependencies"
      >
        No nodes yet.
      </div>
    )
  }

  return (
    <div className="px-6 py-4" data-testid="graph-dependencies">
      <Legend />
      <div className="overflow-x-auto">
        <div
          className="relative"
          style={{ width: geo.width, height: geo.height }}
        >
          {/* Column headers */}
          {Array.from({ length: layout.columns }, (_, column) => (
            <div
              key={column}
              className="absolute top-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              style={{ left: colX(column), width: BAR_W }}
            >
              {column === DECISION_COLUMN ? 'Open decisions' : `Step ${column}`}
            </div>
          ))}

          {/* Lanes */}
          {layout.lanes.map((lane, index) => (
            <div
              key={lane.key}
              className="absolute right-0 left-0 border-t"
              style={{
                top: geo.laneTop[index],
                height: lane.rows * ROW_H + LANE_PAD * 2,
              }}
              data-testid="dependency-lane"
            >
              <div
                className="absolute top-3 left-0 flex flex-col gap-0.5 text-xs"
                style={{ width: LABEL_W - 12 }}
              >
                {lane.nodeId ? (
                  <button
                    type="button"
                    className="truncate text-left font-semibold hover:underline"
                    onClick={() => onSelectNode(lane.nodeId)}
                  >
                    {lane.title}
                  </button>
                ) : (
                  <span className="flex items-center gap-1 font-semibold">
                    {lane.title}
                    {lane.external && (
                      <ArrowUpRight className="size-3" aria-hidden="true" />
                    )}
                  </span>
                )}
                {lane.progressTotal > 0 && (
                  <span className="text-muted-foreground">
                    {lane.progressDone}/{lane.progressTotal} done
                  </span>
                )}
              </div>
            </div>
          ))}

          <Edges layout={layout} geo={geo} barByKey={barByKey} />

          {/* Open decisions */}
          {layout.decisions.map(decision => (
            <div
              key={decision.key}
              className="absolute flex items-start gap-1.5 text-xs text-red-500"
              style={{
                left: colX(DECISION_COLUMN),
                top: rowY(geo, decision.lane, decision.row) + 8,
                width: BAR_W - 24,
              }}
              data-testid="dependency-decision"
              title={`blocked-by: ${decision.text}`}
            >
              <span
                className="mt-0.5 size-2.5 shrink-0 rotate-45 border-[1.5px] border-red-500 bg-background"
                aria-hidden="true"
              />
              <span className="line-clamp-2">{decision.text}</span>
            </div>
          ))}

          {/* Bars */}
          {layout.bars.map(bar => (
            <Bar
              key={bar.key}
              bar={bar}
              geo={geo}
              selected={bar.nodeId !== null && bar.nodeId === selectedNodeId}
              detail={detail}
              onSelect={onSelectNode}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Bar({
  bar,
  geo,
  selected,
  detail,
  onSelect,
}: {
  bar: DependencyBar
  geo: Geometry
  selected: boolean
  detail: GraphTabProps['detail']
  onSelect: (nodeId: string | null) => void
}) {
  const node = bar.nodeId
    ? detail.nodes.find(n => n.id === bar.nodeId)
    : undefined
  const derived = bar.nodeId ? detail.derived[bar.nodeId] : undefined
  const issue = node ? issueNumber(node.attachments) : null
  const external = bar.externalRef !== null

  return (
    <button
      type="button"
      disabled={external}
      onClick={() => bar.nodeId && onSelect(bar.nodeId)}
      data-testid="dependency-bar"
      data-node-id={bar.nodeId ?? undefined}
      title={bar.title}
      className={cn(
        'absolute flex flex-col justify-center overflow-hidden rounded-md border border-l-4 bg-card px-2 text-left shadow-xs transition-colors',
        bar.state ? STRIPE[bar.state] : 'border-l-muted-foreground/30',
        external && 'border-dashed border-blue-500/50 bg-blue-500/5',
        bar.state === 'proposed' && 'border-dashed',
        bar.state === 'done' && 'opacity-60',
        bar.state === 'dropped' && 'opacity-40 line-through',
        selected && 'ring-2 ring-ring',
        !external && 'hover:bg-accent/50'
      )}
      style={{
        left: colX(bar.column),
        top: rowY(geo, bar.lane, bar.row),
        width: BAR_W,
        height: BAR_H,
      }}
    >
      <span className="truncate text-sm font-medium">{bar.title}</span>
      <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        {external ? (
          <span className="flex min-w-0 items-center gap-0.5 text-blue-500">
            <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{bar.graphTitle ?? 'other graph'}</span>
          </span>
        ) : (
          <span>{bar.state}</span>
        )}
        {issue && <span>{issue}</span>}
        {derived?.active && (
          <span className="flex items-center gap-0.5 text-orange-500">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            active
          </span>
        )}
        {derived?.blocked && (
          <span
            className="flex items-center gap-0.5 text-red-500"
            title={derived.blockers.join('\n')}
          >
            <Ban className="size-3" aria-hidden="true" />
            blocked
          </span>
        )}
      </span>
    </button>
  )
}

function Edges({
  layout,
  geo,
  barByKey,
}: {
  layout: DependencyLayout
  geo: Geometry
  barByKey: Map<string, DependencyBar>
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={geo.width}
      height={geo.height}
      aria-hidden="true"
    >
      <defs>
        {[
          ['dep-red', RED],
          ['dep-grey', GREY],
          ['dep-blue', BLUE],
        ].map(([id, color]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        ))}
      </defs>

      {layout.edges.map(edge => {
        const from = barByKey.get(edge.from)
        const to = barByKey.get(edge.to)
        if (!from || !to) return null
        const color = edge.kind === 'relates-to' ? BLUE : edge.done ? GREY : RED
        const marker =
          edge.kind === 'relates-to'
            ? 'dep-blue'
            : edge.done
              ? 'dep-grey'
              : 'dep-red'
        const fy = rowY(geo, from.lane, from.row) + BAR_H / 2
        const ty = rowY(geo, to.lane, to.row) + BAR_H / 2
        let d: string
        if (to.column > from.column) {
          const fx = colX(from.column) + BAR_W
          const tx = colX(to.column)
          const mid = (fx + tx) / 2
          d = `M ${fx} ${fy} C ${mid} ${fy}, ${mid} ${ty}, ${tx} ${ty}`
        } else {
          // Same column (an external node placed under its link): vertical.
          const x = colX(to.column) + BAR_W / 2
          const down = ty > fy
          const y1 = fy + (down ? BAR_H / 2 : -BAR_H / 2)
          const y2 = ty + (down ? -BAR_H / 2 : BAR_H / 2)
          d = `M ${x} ${y1} L ${x} ${y2}`
        }
        return (
          <path
            key={edge.key}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={edge.kind === 'relates-to' ? '2 3' : undefined}
            markerEnd={`url(#${marker})`}
            data-testid={`dependency-edge-${edge.kind}`}
          />
        )
      })}

      {/* Decision → blocked node: along the lane top, not across bars. */}
      {layout.decisions.map(decision => {
        const target = barByKey.get(decision.nodeId)
        const dx = colX(DECISION_COLUMN) + 5
        const dy = rowY(geo, decision.lane, decision.row) + 8
        const top = (geo.laneTop[decision.lane] ?? 0) + 5
        if (!target) return null
        const tx = colX(target.column)
        const ty = rowY(geo, target.lane, target.row) + BAR_H / 2
        return (
          <path
            key={decision.key}
            d={`M ${dx} ${dy} V ${top} H ${tx - 10} V ${ty} H ${tx}`}
            fill="none"
            stroke={RED}
            strokeWidth={1.25}
            strokeDasharray="4 3"
            markerEnd="url(#dep-red)"
          />
        )
      })}
    </svg>
  )
}

function Legend() {
  const item = (stroke: string, dash: string | undefined, label: string) => (
    <span className="flex items-center gap-1.5">
      <svg width="26" height="8" aria-hidden="true">
        <line
          x1="0"
          y1="4"
          x2="26"
          y2="4"
          stroke={stroke}
          strokeWidth="1.5"
          strokeDasharray={dash}
        />
      </svg>
      {label}
    </span>
  )
  return (
    <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {item(RED, undefined, 'depends-on, target not done')}
      {item(GREY, undefined, 'depends-on, done')}
      {item(RED, '4 3', 'blocked-by (open decision)')}
      {item(BLUE, '2 3', 'relates-to (other graph)')}
      <span>Columns are dependency steps, not dates.</span>
    </div>
  )
}
