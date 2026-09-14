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
import { Input } from '@/components/ui/input'
import { HomeSection } from './HomeSection'
import {
  flattenAllSessions,
  HOME_FILTER_MIN_ITEMS,
  matchesSessionQuery,
  resolveSessionLabel,
} from './home-utils'

interface RecentSessionsSectionProps {
  /**
   * Narrow the list to one project. Home passes nothing and lists every
   * project; the project home passes its own id.
   */
  projectId?: string
}

export const RecentSessionsSection = memo(function RecentSessionsSection({
  projectId,
}: RecentSessionsSectionProps = {}) {
  const { data, isLoading } = useAllSessions()
  const storeState = useCanvasStoreState()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LabelFilter>(() => new Set<string>())

  const rows = useMemo(() => {
    const all = flattenAllSessions(data?.entries ?? [])
    return projectId ? all.filter(row => row.projectId === projectId) : all
  }, [data?.entries, projectId])

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

  // Every matching session, newest first. Nothing waits behind a "show more"
  // step: the column scrolls on its own, and the filter narrows a long list.
  const visible = useMemo(
    () =>
      rows.filter(row => {
        const label = resolveSessionLabel(row.session, storeState.sessionLabels)
        return (
          matchesSessionQuery(row, query, label) &&
          sessionMatchesLabelFilter(row.session, activeFilter, label)
        )
      }),
    [rows, query, activeFilter, storeState.sessionLabels]
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

  if (rows.length === 0) {
    // On Home an empty list means an empty app, and a heading over nothing is
    // noise. A project with no sessions yet is ordinary, and its column must
    // still say what belongs there.
    if (!projectId) return null
    return (
      <HomeSection title="Recent sessions">
        <p className="text-sm text-muted-foreground">
          No sessions yet. Open a worktree to start one.
        </p>
      </HomeSection>
    )
  }

  // A project list is already narrowed to one project, so it is shorter and the
  // filter earns its place sooner than it does on Home.
  const filterThreshold = projectId ? 2 : HOME_FILTER_MIN_ITEMS
  // The field stays while it holds a query, so a filter can never be active
  // with no visible way to clear it.
  const showQueryField = rows.length >= filterThreshold || query !== ''

  return (
    <HomeSection
      title="Recent sessions"
      action={
        showQueryField ? (
          <Input
            placeholder="Filter sessions..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-8 max-w-[12rem]"
          />
        ) : undefined
      }
    >
      <LabelFilterChips
        options={labelOptions}
        filter={activeFilter}
        onToggle={handleToggle}
        onClear={handleClear}
      />

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.trim() ? (
            <>No sessions match &ldquo;{query.trim()}&rdquo;</>
          ) : (
            'No session carries the selected label.'
          )}
        </p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-border/60 rounded-md border bg-muted/20"
          data-testid="home-recent-sessions"
        >
          {visible.map(row => (
            <RecentSessionRow
              key={row.session.id}
              row={row}
              storeState={storeState}
              hideProjectName={!!projectId}
            />
          ))}
        </ul>
      )}
    </HomeSection>
  )
})

/** One Home session row. Shared by the Recent sessions and Starred sections. */
export function RecentSessionRow({
  row,
  storeState,
  hideProjectName = false,
}: {
  row: ReturnType<typeof flattenAllSessions>[number]
  storeState: ReturnType<typeof useCanvasStoreState>
  /** Drop the project name from line 2. Set where every row is one project. */
  hideProjectName?: boolean
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
            {hideProjectName
              ? row.worktreeName
              : `${row.projectName} / ${row.worktreeName}`}
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
