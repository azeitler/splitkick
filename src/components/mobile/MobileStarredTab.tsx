import { memo, useMemo } from 'react'
import { Star } from 'lucide-react'
import { useAllSessions } from '@/services/chat'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { useProjectsStore } from '@/store/projects-store'
import { resolveStarredSessions } from '@/components/home/home-utils'
import {
  MobileEmptyState,
  MobileSessionList,
  MobileTabPage,
} from './MobileTabPage'

/** The Starred tab: every starred session, in star order. */
export const MobileStarredTab = memo(function MobileStarredTab() {
  const stars = useProjectsStore(state => state.starredSessions)
  const { data, isLoading } = useAllSessions(stars.length > 0)
  const storeState = useCanvasStoreState()

  const rows = useMemo(
    () => resolveStarredSessions(stars, data?.entries ?? []),
    [stars, data?.entries]
  )

  return (
    <MobileTabPage title="Starred" testId="mobile-tab-starred">
      {rows.length > 0 ? (
        <MobileSessionList
          rows={rows}
          storeState={storeState}
          testId="mobile-starred-sessions"
        />
      ) : stars.length > 0 && isLoading ? (
        <p className="px-1 text-sm text-muted-foreground">
          Loading starred sessions…
        </p>
      ) : stars.length > 0 ? (
        // Stars are never pruned, so they can outlive their sessions. Say so,
        // rather than claiming nothing is starred.
        <MobileEmptyState icon={Star} title="Starred sessions not found">
          The sessions you starred were archived or deleted. Unarchive one to
          bring it back here.
        </MobileEmptyState>
      ) : (
        <MobileEmptyState icon={Star} title="No starred sessions">
          Star a session from its menu to keep it one tap away.
        </MobileEmptyState>
      )}
    </MobileTabPage>
  )
})
