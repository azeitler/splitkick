import { createElement, memo, useCallback, useMemo, useState } from 'react'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { getLabelTextColor } from '@/lib/label-colors'
import { formatRelativeTime } from '@/lib/relative-time'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useAllSessions } from '@/services/chat'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import {
  computeSessionCardData,
  statusConfig,
} from '@/components/chat/session-card-utils'
import { getBackendIcon, getBackendLabel } from '@/components/ui/backend-label'
import type { CliBackend } from '@/types/preferences'
import { LabelFilterChips } from '@/components/labels/LabelFilterChips'
import {
  collectLabelOptions,
  pruneLabelFilter,
  sessionMatchesLabelFilter,
  toggleLabelFilter,
  type LabelFilter,
} from '@/lib/label-filter'
import { flattenAllSessions, resolveSessionLabel } from './home-utils'

/** Rows shown before the "show more" step. */
const COLLAPSED_COUNT = 8
/** Rows shown after it. The list stays a summary, not a full session browser. */
const EXPANDED_COUNT = 25

export const RecentSessionsSection = memo(function RecentSessionsSection() {
  const { data, isLoading } = useAllSessions()
  const storeState = useCanvasStoreState()
  const [filter, setFilter] = useState<LabelFilter>(() => new Set<string>())
  const [expanded, setExpanded] = useState(false)

  const rows = useMemo(
    () => flattenAllSessions(data?.entries ?? []),
    [data?.entries]
  )

  const labelOptions = useMemo(
    () =>
      collectLabelOptions(
        rows.map(row => {
          const label = resolveSessionLabel(
            row.session,
            storeState.sessionLabels
          )
          return label ? [label] : []
        })
      ),
    [rows, storeState.sessionLabels]
  )

  // A label that no session carries any more must not hide every row.
  const activeFilter = useMemo(
    () => pruneLabelFilter(filter, labelOptions),
    [filter, labelOptions]
  )

  const visible = useMemo(() => {
    const matching = rows.filter(row =>
      sessionMatchesLabelFilter(
        row.session,
        activeFilter,
        storeState.sessionLabels[row.session.id]
      )
    )
    return matching.slice(0, expanded ? EXPANDED_COUNT : COLLAPSED_COUNT)
  }, [rows, activeFilter, storeState.sessionLabels, expanded])

  const matchCount = useMemo(
    () =>
      rows.filter(row =>
        sessionMatchesLabelFilter(
          row.session,
          activeFilter,
          storeState.sessionLabels[row.session.id]
        )
      ).length,
    [rows, activeFilter, storeState.sessionLabels]
  )

  const handleToggle = useCallback((name: string) => {
    setFilter(current => toggleLabelFilter(current, name))
  }, [])

  const handleClear = useCallback(() => setFilter(new Set<string>()), [])

  if (isLoading) {
    return (
      <HomeSection title="Recent sessions">
        <p className="text-sm text-muted-foreground">Loading sessions…</p>
      </HomeSection>
    )
  }

  if (rows.length === 0) return null

  return (
    <HomeSection
      title="Recent sessions"
      action={
        <LabelFilterChips
          options={labelOptions}
          filter={activeFilter}
          onToggle={handleToggle}
          onClear={handleClear}
        />
      }
    >
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No session carries the selected label.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 rounded-md border bg-muted/20">
          {visible.map(row => (
            <RecentSessionRow
              key={row.session.id}
              row={row}
              storeState={storeState}
            />
          ))}
        </ul>
      )}

      {matchCount > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded
            ? 'Show fewer'
            : `Show ${Math.min(matchCount, EXPANDED_COUNT) - COLLAPSED_COUNT} more`}
        </button>
      )}
    </HomeSection>
  )
})

/** One Home session row. Shared by the Recent sessions and Starred sections. */
export function RecentSessionRow({
  row,
  storeState,
}: {
  row: ReturnType<typeof flattenAllSessions>[number]
  storeState: ReturnType<typeof useCanvasStoreState>
}) {
  const card = useMemo(
    () => computeSessionCardData(row.session, storeState),
    [row.session, storeState]
  )
  const status = statusConfig[card.status]
  const label = card.label ?? undefined

  const handleOpen = useCallback(() => {
    navigateToSession({
      projectId: row.projectId,
      worktreeId: row.worktreeId,
      sessionId: row.session.id,
    })
  }, [row])

  // Two lines, so the row still reads in a narrow Home column: the name and
  // the time on top, where the project and the badges would otherwise squeeze
  // the name to a few characters. The grid keeps line 2 under the name
  // whatever the status glyph's width.
  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 px-3 py-2 text-left transition-colors hover:bg-accent/50"
      >
        <StatusIndicator
          status={status.indicatorStatus}
          variant={status.indicatorVariant}
          shape={status.indicatorShape}
          label={status.label}
          className="shrink-0"
        />

        <span className="truncate text-sm">
          {row.session.name || 'Untitled'}
        </span>

        <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
          {formatRelativeTime(row.activityAt)}
        </span>

        <span className="col-start-2 col-end-4 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {row.projectName} / {row.worktreeName}
          </span>

          {label && (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: label.color,
                color: getLabelTextColor(label.color),
              }}
            >
              {label.name}
            </span>
          )}

          <BackendGlyph backend={row.session.backend} />
        </span>
      </button>
    </li>
  )
}

/**
 * The backend icon of a session.
 *
 * `getBackendIcon` returns one of a fixed set of components, so the element is
 * built with `createElement` rather than through a local JSX tag: a capitalised
 * local would read as a component declared during render.
 */
function BackendGlyph({ backend }: { backend?: CliBackend }) {
  if (!backend) return null
  return createElement(getBackendIcon(backend), {
    className: 'size-3.5 shrink-0',
    'aria-label': getBackendLabel(backend),
  })
}

/** Shared frame for the Home sections. */
export function HomeSection({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
