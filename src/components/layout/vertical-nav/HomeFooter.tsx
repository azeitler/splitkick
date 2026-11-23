import { useMemo } from 'react'
import { flattenAllSessions } from '@/components/home/home-utils'
import { useAllSessions } from '@/services/chat'
import { useProjects } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import { isVisibleProject } from '@/types/projects'

const countTrue = (record: Record<string, boolean>) =>
  Object.values(record).filter(Boolean).length

/** Unix seconds at the start of today, local time. */
function startOfTodaySeconds(): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start.getTime() / 1000
}

function Stat({
  value,
  label,
  dot,
  testId,
}: {
  value: number
  label: string
  dot?: string
  testId: string
}) {
  return (
    <span
      data-testid={testId}
      className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs text-muted-foreground"
    >
      {dot && (
        <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
      )}
      <span className="font-medium text-foreground tabular-nums">{value}</span>
      {label}
    </span>
  )
}

/**
 * The footer next to the compact sidebar footer on Home (vertical
 * navigation). Same design as the sidebar footer; empty left, stats right.
 */
export function HomeFooter() {
  const running = useChatStore(state => countTrue(state.sendingSessionIds))
  const waiting = useChatStore(state =>
    countTrue(state.waitingForInputSessionIds)
  )
  const { data } = useAllSessions()
  const { data: projects } = useProjects()

  const sessionsToday = useMemo(() => {
    const start = startOfTodaySeconds()
    return flattenAllSessions(data?.entries ?? []).filter(
      row => row.activityAt >= start
    ).length
  }, [data?.entries])
  const projectCount = useMemo(
    () => (projects ?? []).filter(isVisibleProject).length,
    [projects]
  )

  return (
    <div
      data-testid="home-footer"
      className="flex h-10 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden border-t border-border/60 bg-sidebar px-2"
    >
      <Stat
        testId="home-footer-running"
        value={running}
        label="running"
        dot="bg-green-500"
      />
      <Stat
        testId="home-footer-waiting"
        value={waiting}
        label="waiting"
        dot="bg-amber-500"
      />
      <Stat
        testId="home-footer-today"
        value={sessionsToday}
        label="sessions today"
      />
      <Stat
        testId="home-footer-projects"
        value={projectCount}
        label={projectCount === 1 ? 'project' : 'projects'}
      />
    </div>
  )
}
