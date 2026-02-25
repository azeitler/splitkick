import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  BellDot,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  CirclePause,
  Eye,
  HelpCircle,
  FileText,
} from 'lucide-react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useAllSessions } from '@/services/chat'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useUnreadCount } from './useUnreadCount'
import type { Session } from '@/types/chat'

function isUnread(session: Session): boolean {
  if (session.archived_at) return false
  const actionableStatuses = ['completed', 'cancelled', 'crashed']
  const hasFinishedRun =
    session.last_run_status &&
    actionableStatuses.includes(session.last_run_status)
  const isWaiting = session.waiting_for_input
  const isReviewing = session.is_reviewing
  if (!hasFinishedRun && !isWaiting && !isReviewing) return false
  if (!session.last_opened_at) return true
  return session.last_opened_at < session.updated_at
}

function formatRelativeTime(timestamp: number): string {
  const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  const diffMs = Date.now() - ms
  if (diffMs < 0) return 'just now'
  const minuteMs = 60_000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  if (diffMs < hourMs)
    return `${Math.max(1, Math.floor(diffMs / minuteMs))}m ago`
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h ago`
  return `${Math.floor(diffMs / dayMs)}d ago`
}

interface UnreadItem {
  session: Session
  projectId: string
  projectName: string
  worktreeId: string
  worktreeName: string
  worktreePath: string
}

function getSessionStatus(session: Session) {
  if (session.waiting_for_input) {
    const isplan = session.waiting_for_input_type === 'plan'
    return {
      icon: isplan ? FileText : HelpCircle,
      label: isplan ? 'Needs approval' : 'Needs input',
      className: 'text-yellow-500',
    }
  }
  if (session.is_reviewing) {
    return {
      icon: Eye,
      label: 'Review ready',
      className: 'text-green-500',
    }
  }
  const config: Record<
    string,
    { icon: typeof CheckCircle2; label: string; className: string }
  > = {
    completed: {
      icon: CheckCircle2,
      label: 'Completed',
      className: 'text-green-500',
    },
    cancelled: {
      icon: CirclePause,
      label: 'Cancelled',
      className: 'text-muted-foreground',
    },
    crashed: {
      icon: AlertTriangle,
      label: 'Crashed',
      className: 'text-destructive',
    },
  }
  if (session.last_run_status && config[session.last_run_status]) {
    return config[session.last_run_status]
  }
  return null
}

interface UnreadBellProps {
  title: string
  hideTitle?: boolean
}

export function UnreadBell({ title, hideTitle }: UnreadBellProps) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const unreadCount = useUnreadCount()
  const { data: allSessions, isLoading } = useAllSessions(open)
  const selectedProjectId = useProjectsStore(
    state => state.selectedProjectId
  )

  // Listen for command palette event to open the popover
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('command:open-unread-sessions', handler)
    return () =>
      window.removeEventListener('command:open-unread-sessions', handler)
  }, [])

  // Invalidate cache each time popover opens
  useEffect(() => {
    if (open) {
      queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
    }
  }, [open, queryClient])

  // Invalidate when any session is opened (so the count stays fresh)
  useEffect(() => {
    const handler = () =>
      queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
    window.addEventListener('session-opened', handler)
    return () => window.removeEventListener('session-opened', handler)
  }, [queryClient])

  const unreadItems = useMemo((): UnreadItem[] => {
    if (!allSessions) return []
    const results: UnreadItem[] = []
    for (const entry of allSessions.entries) {
      for (const session of entry.sessions) {
        if (isUnread(session)) {
          results.push({
            session,
            projectId: entry.project_id,
            projectName: entry.project_name,
            worktreeId: entry.worktree_id,
            worktreeName: entry.worktree_name,
            worktreePath: entry.worktree_path,
          })
        }
      }
    }
    return results.sort(
      (a, b) => b.session.updated_at - a.session.updated_at
    )
  }, [allSessions])

  const groupedItems = useMemo(() => {
    const groups = new Map<
      string,
      { projectId: string; projectName: string; items: UnreadItem[] }
    >()
    for (const item of unreadItems) {
      const existing = groups.get(item.projectId)
      if (existing) {
        existing.items.push(item)
      } else {
        groups.set(item.projectId, {
          projectId: item.projectId,
          projectName: item.projectName,
          items: [item],
        })
      }
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.projectId === selectedProjectId) return -1
      if (b.projectId === selectedProjectId) return 1
      return a.projectName.localeCompare(b.projectName)
    })
  }, [unreadItems, selectedProjectId])

  const handleSelect = useCallback((item: UnreadItem) => {
    const { selectedProjectId, selectProject, selectWorktree } =
      useProjectsStore.getState()
    const { setActiveWorktree, setActiveSession, setViewingCanvasTab } =
      useChatStore.getState()

    if (selectedProjectId !== item.projectId) {
      selectProject(item.projectId)
    }

    selectWorktree(item.worktreeId)
    setActiveWorktree(item.worktreeId, item.worktreePath)
    setActiveSession(item.worktreeId, item.session.id)
    setViewingCanvasTab(item.worktreeId, true)
    setOpen(false)

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('open-session-modal', {
          detail: { sessionId: item.session.id },
        })
      )
    }, 50)
  }, [])

  // No unread → show normal title (or nothing if hideTitle)
  if (unreadCount === 0) {
    if (hideTitle) return null
    return (
      <span className="block truncate text-sm font-medium text-foreground/80">
        {title}
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="card-border-spin">
          <button
            type="button"
            className="relative z-[1] flex items-center gap-1.5 truncate rounded-md bg-background px-1.5 text-sm font-medium text-yellow-400 cursor-pointer"
          >
            <BellDot className="h-3.5 w-3.5 shrink-0 animate-[bell-ring_2s_ease-in-out_infinite]" />
            {unreadCount} finished{' '}
            {unreadCount === 1 ? 'session' : 'sessions'}
          </button>
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={6}
        className="w-[380px] p-0"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : unreadItems.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-xs">
            No unread sessions
          </div>
        ) : (
          <ScrollArea className="max-h-[min(400px,60vh)]">
            <div className="p-1">
              {groupedItems.map(group => (
                <div key={group.projectId}>
                  <div className="text-[10px] font-medium uppercase tracking-wider px-2 pt-1.5 pb-0.5 text-muted-foreground">
                    {group.projectName}
                  </div>
                  {group.items.map(item => {
                    const status = getSessionStatus(item.session)
                    const StatusIcon = status?.icon ?? CheckCircle2

                    return (
                      <button
                        key={item.session.id}
                        type="button"
                        onClick={() => handleSelect(item)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors cursor-pointer flex items-center gap-2"
                      >
                        <StatusIcon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            status?.className ?? 'text-muted-foreground'
                          )}
                        />
                        <span className="text-sm truncate flex-1 min-w-0">
                          {item.session.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground/60 shrink-0">
                          {item.worktreeName}
                        </span>
                        <span className="text-[11px] text-muted-foreground/40 shrink-0">
                          {formatRelativeTime(item.session.updated_at)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
