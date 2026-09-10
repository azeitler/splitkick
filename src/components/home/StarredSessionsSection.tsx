import { memo, useMemo } from 'react'
import { useAllSessions } from '@/services/chat'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { useProjectsStore } from '@/store/projects-store'
import { resolveStarredSessions } from './home-utils'
import { HomeSection, RecentSessionRow } from './RecentSessionsSection'

/**
 * The starred sessions on the Home view, in star order.
 *
 * Same rows as "Recent sessions", from the same all-sessions cache, so a star
 * looks and opens exactly like the session does in the list below it. Hidden
 * entirely while nothing starred resolves.
 */
export const StarredSessionsSection = memo(function StarredSessionsSection() {
  const stars = useProjectsStore(state => state.starredSessions)
  const { data } = useAllSessions(stars.length > 0)
  const storeState = useCanvasStoreState()

  const rows = useMemo(
    () => resolveStarredSessions(stars, data?.entries ?? []),
    [stars, data?.entries]
  )

  if (rows.length === 0) return null

  return (
    <HomeSection title="Starred">
      <ul
        className="flex flex-col divide-y divide-border/60 rounded-md border bg-muted/20"
        data-testid="home-starred-sessions"
      >
        {rows.map(row => (
          <RecentSessionRow
            key={row.session.id}
            row={row}
            storeState={storeState}
          />
        ))}
      </ul>
    </HomeSection>
  )
})
