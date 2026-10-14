import { useEffect, useMemo, useRef } from 'react'
import { invoke } from '@/lib/transport'
import { isNativeApp } from '@/lib/environment'
import { isClientMacOS } from '@/lib/platform'
import { isConnectionWindow } from '@/lib/remote-connections'
import { logger } from '@/lib/logger'
import { useAllSessions } from '@/services/chat'
import { buildDockSessions, countUnreadSessions } from '@/lib/dock'

/**
 * Keeps the macOS dock badge (unread count) and the dock menu (sessions) in
 * line with the local sessions. The dock belongs to the app, so only the main
 * window, which talks to the local backend, sends them.
 */
export function useDockSync(): void {
  const enabled = isNativeApp() && isClientMacOS && !isConnectionWindow()
  const { data: allSessions } = useAllSessions(enabled)
  const unreadCount = useMemo(
    () => countUnreadSessions(allSessions),
    [allSessions]
  )
  const sessionsJson = useMemo(
    () => JSON.stringify(buildDockSessions(allSessions)),
    [allSessions]
  )
  const sent = useRef<{ count?: number; sessions?: string }>({})

  useEffect(() => {
    if (!enabled || sent.current.count === unreadCount) return
    sent.current.count = unreadCount
    void invoke('set_dock_badge', { count: unreadCount }).catch(error =>
      logger.warn('Failed to set dock badge', { error: String(error) })
    )
  }, [enabled, unreadCount])

  useEffect(() => {
    if (!enabled || sent.current.sessions === sessionsJson) return
    sent.current.sessions = sessionsJson
    void invoke('set_dock_sessions', {
      sessions: JSON.parse(sessionsJson),
    }).catch(error =>
      logger.warn('Failed to set dock menu', { error: String(error) })
    )
  }, [enabled, sessionsJson])
}
