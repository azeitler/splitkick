import { useEffect } from 'react'

interface UseToolbarDropdownShortcutsArgs {
  enabled?: boolean
  setProviderDropdownOpen?: (open: boolean) => void
  setModelDropdownOpen?: (open: boolean) => void
  setThinkingDropdownOpen?: (open: boolean) => void
}

export function useToolbarDropdownShortcuts({
  enabled = true,
  setProviderDropdownOpen,
  setModelDropdownOpen,
  setThinkingDropdownOpen,
}: UseToolbarDropdownShortcutsArgs) {
  useEffect(() => {
    if (!enabled) return

    const unlisteners: (() => void)[] = []

    if (setProviderDropdownOpen) {
      const onProvider = () => setProviderDropdownOpen(true)
      window.addEventListener('open-provider-dropdown', onProvider)
      unlisteners.push(() =>
        window.removeEventListener('open-provider-dropdown', onProvider)
      )
    }

    if (setModelDropdownOpen) {
      const onModel = () => setModelDropdownOpen(true)
      window.addEventListener('open-model-dropdown', onModel)
      unlisteners.push(() =>
        window.removeEventListener('open-model-dropdown', onModel)
      )
    }

    if (setThinkingDropdownOpen) {
      const onThinking = () => setThinkingDropdownOpen(true)
      window.addEventListener('open-thinking-dropdown', onThinking)
      unlisteners.push(() =>
        window.removeEventListener('open-thinking-dropdown', onThinking)
      )
    }

    return () => {
      for (const unlisten of unlisteners) unlisten()
    }
  }, [
    enabled,
    setModelDropdownOpen,
    setProviderDropdownOpen,
    setThinkingDropdownOpen,
  ])
}
