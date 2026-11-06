import { useIsHomeActive } from '@/components/home/useIsHomeActive'
import { useUIStore } from '@/store/ui-store'

/**
 * Whether the left context panel (#98) is on screen. Home has no files to
 * browse and no current session, so it hides the panel without touching the
 * persisted visibility, except for a network pinned from a sidebar row
 * ("Show Session Network").
 */
export function useContextPanelShown(): boolean {
  const isHomeActive = useIsHomeActive()
  return useUIStore(
    state =>
      state.fileBrowserVisible &&
      (!isHomeActive ||
        (state.contextPanelTab === 'network' &&
          state.sessionNetworkSessionId !== null))
  )
}
