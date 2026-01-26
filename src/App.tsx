import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { initializeCommandSystem } from './lib/commands'
import { logger } from './lib/logger'
import { cleanupOldFiles } from './lib/recovery'
import './App.css'
import MainWindow from './components/layout/MainWindow'
import { ThemeProvider } from './components/ThemeProvider'
import ErrorBoundary from './components/ErrorBoundary'
import { useClaudeCliStatus } from './services/claude-cli'
import { useGhCliStatus } from './services/gh-cli'
import { useUIStore } from './store/ui-store'
import { useChatStore } from './store/chat-store'
import { useFontSettings } from './hooks/use-font-settings'
import { useImmediateSessionStateSave } from './hooks/useImmediateSessionStateSave'
import { useCliVersionCheck } from './hooks/useCliVersionCheck'
import { useQueueProcessor } from './hooks/useQueueProcessor'
import useStreamingEvents from './components/chat/hooks/useStreamingEvents'
import { preloadAllSounds } from './lib/sounds'

function App() {
  // Apply font settings from preferences
  useFontSettings()

  // Save reviewing/waiting state immediately (no debounce) to ensure persistence on reload
  useImmediateSessionStateSave()

  // Check for CLI updates on startup (shows toast notification if updates available)
  useCliVersionCheck()

  // Global streaming event listeners - must be at App level so they stay active
  // even when ChatWindow is unmounted (e.g., when viewing session board)
  const queryClient = useQueryClient()
  useStreamingEvents({ queryClient })

  // Global queue processor - must be at App level so queued messages execute
  // even when the worktree is not focused (ChatWindow unmounted)
  useQueueProcessor()

  // Check CLI installation status
  const { data: claudeStatus, isLoading: isClaudeStatusLoading } =
    useClaudeCliStatus()
  const { data: ghStatus, isLoading: isGhStatusLoading } = useGhCliStatus()

  // Show onboarding if either CLI is not installed
  useEffect(() => {
    const isLoading = isClaudeStatusLoading || isGhStatusLoading
    const needsOnboarding = !claudeStatus?.installed || !ghStatus?.installed

    if (!isLoading && needsOnboarding) {
      logger.info('CLI(s) not installed, showing onboarding', {
        claude: claudeStatus?.installed,
        gh: ghStatus?.installed,
      })
      useUIStore.getState().setOnboardingOpen(true)
    }
  }, [claudeStatus, ghStatus, isClaudeStatusLoading, isGhStatusLoading])

  // Kill all terminals on page refresh/close (backup for Rust-side cleanup)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Best-effort sync cleanup for refresh scenarios
      // Note: async operations may not complete, but Rust-side RunEvent::Exit
      // will handle proper cleanup on app quit
      invoke('kill_all_terminals').catch(() => {})
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Initialize command system and cleanup on app startup
  useEffect(() => {
    logger.info('🚀 Frontend application starting up')
    initializeCommandSystem()
    logger.debug('Command system initialized')

    // Preload notification sounds for instant playback
    preloadAllSounds()

    // Kill any orphaned terminals from previous session/reload
    // This ensures cleanup even if beforeunload didn't complete
    invoke<number>('kill_all_terminals')
      .then(killed => {
        if (killed > 0) {
          logger.info(`Cleaned up ${killed} orphaned terminal(s) from previous session`)
        }
      })
      .catch(error => {
        logger.warn('Failed to cleanup orphaned terminals', { error })
      })

    // Clean up old recovery files on startup
    cleanupOldFiles().catch(error => {
      logger.warn('Failed to cleanup old recovery files', { error })
    })

    // Check for and resume any detached Claude sessions that are still running
    interface ResumableSession {
      session_id: string
      worktree_id: string
      run_id: string
      user_message: string
      resumable: boolean
    }
    invoke<ResumableSession[]>('check_resumable_sessions')
      .then(resumable => {
        if (resumable.length > 0) {
          logger.info('Found resumable sessions', { count: resumable.length })
          // Resume each session
          for (const session of resumable) {
            logger.info('Resuming session', {
              session_id: session.session_id,
              worktree_id: session.worktree_id,
            })
            // Mark session as sending to show streaming UI
            useChatStore.getState().addSendingSession(session.session_id)
            // Resume the session (this will start tailing the output file)
            invoke('resume_session', {
              sessionId: session.session_id,
              worktreeId: session.worktree_id,
            }).catch(error => {
              logger.error('Failed to resume session', {
                session_id: session.session_id,
                error,
              })
              useChatStore.getState().removeSendingSession(session.session_id)
            })
          }
        }
      })
      .catch(error => {
        logger.error('Failed to check resumable sessions', { error })
      })

    // Example of logging with context
    logger.info('App environment', {
      isDev: import.meta.env.DEV,
      mode: import.meta.env.MODE,
    })

    // Auto-updater logic - check for updates 5 seconds after app loads
    const checkForUpdates = async () => {
      try {
        const update = await check()
        if (update) {
          logger.info(`Update available: ${update.version}`)

          // Show confirmation dialog
          const shouldUpdate = await ask(
            `Update available: ${update.version}\n\nWould you like to install this update now?`,
            { title: 'Update Available', kind: 'info' }
          )

          if (shouldUpdate) {
            try {
              // Download and install with progress logging
              await update.downloadAndInstall(event => {
                switch (event.event) {
                  case 'Started':
                    logger.info(`Downloading ${event.data.contentLength} bytes`)
                    break
                  case 'Progress':
                    logger.info(`Downloaded: ${event.data.chunkLength} bytes`)
                    break
                  case 'Finished':
                    logger.info('Download complete, installing...')
                    break
                }
              })

              // Ask if user wants to restart now
              const shouldRestart = await ask(
                'Update completed successfully!\n\nWould you like to restart the app now to use the new version?',
                { title: 'Update Complete', kind: 'info' }
              )

              if (shouldRestart) {
                await relaunch()
              }
            } catch (updateError) {
              logger.error(`Update installation failed: ${String(updateError)}`)
              await message(
                `Update failed: There was a problem with the automatic download.\n\n${String(updateError)}`,
                { title: 'Update Failed', kind: 'error' }
              )
            }
          }
        }
      } catch (checkError) {
        logger.error(`Update check failed: ${String(checkError)}`)
        // Silent fail for update checks - don't bother user with network issues
      }
    }

    // Check for updates 5 seconds after app loads
    const updateTimer = setTimeout(checkForUpdates, 5000)
    return () => {
      clearTimeout(updateTimer)
    }
  }, [])

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <MainWindow />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
