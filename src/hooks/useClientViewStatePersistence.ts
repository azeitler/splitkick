import { useEffect } from 'react'
import { useBrowserStore } from '@/store/browser-store'
import { useProjectsStore } from '@/store/projects-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useUIStore } from '@/store/ui-store'
import {
  loadStoredClientViewState,
  saveClientViewState,
} from '@/lib/client-view-state'
import {
  applyClientViewState,
  captureClientViewState,
} from '@/lib/client-view-state-store'
import { loadProjectCanvasSortModes } from '@/lib/project-canvas-settings'

export function useClientViewStatePersistence(isInitialized: boolean): void {
  useEffect(() => {
    if (!isInitialized) return

    const stored = loadStoredClientViewState()
    if (stored) {
      applyClientViewState(stored)
    } else {
      const legacySortModes = loadProjectCanvasSortModes()
      if (Object.keys(legacySortModes).length > 0) {
        useProjectsStore.setState(state => ({
          projectCanvasSettings: Object.entries(legacySortModes).reduce(
            (settings, [projectId, worktreeSortMode]) => ({
              ...settings,
              [projectId]: {
                ...settings[projectId],
                worktreeSortMode,
              },
            }),
            state.projectCanvasSettings
          ),
        }))
      }
      saveClientViewState(captureClientViewState())
    }

    const save = () => saveClientViewState(captureClientViewState())
    const unsubProjects = useProjectsStore.subscribe(save)
    const unsubUI = useUIStore.subscribe(save)
    const unsubTerminal = useTerminalStore.subscribe(save)
    const unsubBrowser = useBrowserStore.subscribe(save)

    return () => {
      unsubProjects()
      unsubUI()
      unsubTerminal()
      unsubBrowser()
    }
  }, [isInitialized])
}
