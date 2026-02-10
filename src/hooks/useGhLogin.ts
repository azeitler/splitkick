import { useCallback } from 'react'
import { useGhCliStatus } from '@/services/gh-cli'
import { useUIStore } from '@/store/ui-store'

/**
 * Hook that provides a triggerLogin() function to open the GitHub CLI login modal.
 * Reuses the path-escaping logic from GeneralPane.handleGhLogin.
 */
export function useGhLogin() {
  const { data: ghStatus } = useGhCliStatus()
  const openCliLoginModal = useUIStore(state => state.openCliLoginModal)

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const triggerLogin = useCallback(() => {
    if (!ghStatus?.path) return

    const isWindows = navigator.userAgent.includes('Windows')
    const escapedPath = isWindows
      ? `& "${ghStatus.path}" auth login`
      : `'${ghStatus.path.replace(/'/g, "'\\''")}'` + ' auth login'
    openCliLoginModal('gh', escapedPath)
  }, [ghStatus?.path, openCliLoginModal])

  return { triggerLogin, isGhInstalled: !!ghStatus?.installed }
}
