import { memo, useMemo, useState } from 'react'
import { History } from '@/components/icons/reicon'
import { useAllSessions } from '@/services/chat'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { Input } from '@/components/ui/input'
import {
  HOME_FILTER_MIN_ITEMS,
  matchesSessionQuery,
  resolveSessionLabel,
} from '@/components/home/home-utils'
import { recentlyOpenedSessions } from './mobile-nav-utils'
import {
  MobileEmptyState,
  MobileSessionList,
  MobileTabPage,
} from './MobileTabPage'

/** The History tab: the sessions you opened, most recent first. */
export const MobileHistoryTab = memo(function MobileHistoryTab() {
  const { data, isLoading } = useAllSessions()
  const storeState = useCanvasStoreState()
  const [query, setQuery] = useState('')

  const rows = useMemo(
    () => recentlyOpenedSessions(data?.entries ?? []),
    [data?.entries]
  )

  const visible = useMemo(
    () =>
      rows.filter(row =>
        matchesSessionQuery(
          row,
          query,
          resolveSessionLabel(row.session, storeState.sessionLabels)
        )
      ),
    [rows, query, storeState.sessionLabels]
  )

  // The field stays while it holds a query, so a filter can always be cleared.
  const showFilter = rows.length >= HOME_FILTER_MIN_ITEMS || query !== ''

  return (
    <MobileTabPage title="History" testId="mobile-tab-history">
      {isLoading && rows.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Loading history…</p>
      ) : rows.length === 0 ? (
        <MobileEmptyState icon={History} title="No history yet">
          Sessions you open appear here, most recent first.
        </MobileEmptyState>
      ) : (
        <>
          {showFilter && (
            <Input
              type="search"
              placeholder="Filter history..."
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-11"
              aria-label="Filter history"
            />
          )}
          {visible.length > 0 ? (
            <MobileSessionList
              rows={visible}
              storeState={storeState}
              testId="mobile-history-sessions"
            />
          ) : (
            <p className="px-1 text-sm text-muted-foreground">
              No sessions match &ldquo;{query.trim()}&rdquo;
            </p>
          )}
        </>
      )}
    </MobileTabPage>
  )
})
