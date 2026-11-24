import { useMemo, type ReactNode } from 'react'
import {
  Archive,
  BotMessageSquare,
  CalendarClock,
  Clock,
  FolderOpen,
  ListTodo,
  Star,
  Workflow,
} from 'lucide-react'
import {
  resolveStarredSessions,
  resolveTodoSessions,
} from '@/components/home/home-utils'
import { useAllSessions } from '@/services/chat'
import { useGraphs } from '@/services/graphs'
import { useProjectsStore } from '@/store/projects-store'
import type { SidebarTab } from '@/types/ui-state'

/** Label and icon of each sidebar tab in the vertical navigation. */
export const TAB_META: Record<SidebarTab, { label: string; icon: ReactNode }> =
  {
    projects: { label: 'Projects', icon: <FolderOpen /> },
    recent: { label: 'Recent', icon: <Clock /> },
    starred: { label: 'Starred', icon: <Star /> },
    agents: { label: 'Agents', icon: <BotMessageSquare /> },
    todo: { label: 'To-Do', icon: <ListTodo /> },
    graphs: { label: 'Graphs', icon: <Workflow /> },
    scheduled: { label: 'Scheduled', icon: <CalendarClock /> },
    archived: { label: 'Archived', icon: <Archive /> },
  }

/**
 * Counts in the navigation: starred and To-Do sessions, and graph requests
 * that wait for the user. Same caches the tab contents read, so no new query.
 */
export function useSidebarTabCounts(): Partial<Record<SidebarTab, number>> {
  const stars = useProjectsStore(state => state.starredSessions)
  const { data } = useAllSessions()
  const { data: graphs } = useGraphs()

  return useMemo(() => {
    const entries = data?.entries ?? []
    return {
      starred: resolveStarredSessions(stars, entries).length,
      todo: resolveTodoSessions(entries).length,
      graphs: (graphs ?? []).reduce((sum, g) => sum + g.openRequests, 0),
    }
  }, [stars, data?.entries, graphs])
}
