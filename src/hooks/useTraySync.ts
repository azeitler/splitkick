import { useEffect, useMemo, useRef } from 'react'
import { invoke } from '@/lib/transport'
import { isNativeApp } from '@/lib/environment'
import { isClientLinux } from '@/lib/platform'
import { isConnectionWindow } from '@/lib/remote-connections'
import { logger } from '@/lib/logger'
import { usePreferences } from '@/services/preferences'

/**
 * Rebuilds the menu bar icon at once when its account list or visibility
 * changes. Usage itself is kept current by the backend, also with no window.
 */
export function useTraySync(): void {
  const enabled = isNativeApp() && !isClientLinux && !isConnectionWindow()
  const { data: preferences } = usePreferences()
  const key = useMemo(
    () =>
      preferences
        ? JSON.stringify([
            preferences.show_in_menu_bar,
            preferences.claude_active_account,
            preferences.claude_accounts,
          ])
        : null,
    [preferences]
  )
  const sent = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || key === null || sent.current === key) return
    sent.current = key
    void invoke('refresh_tray').catch(error =>
      logger.warn('Failed to update the menu bar icon', {
        error: String(error),
      })
    )
  }, [enabled, key])
}
