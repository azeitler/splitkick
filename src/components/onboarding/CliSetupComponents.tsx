/**
 * Shared CLI Setup Components
 *
 * Extracted from OnboardingDialog for reuse in both the onboarding wizard
 * and the individual CLI reinstall modal.
 */

import { useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Download, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTerminal } from '@/hooks/useTerminal'
import { disposeTerminal, setOnStopped } from '@/lib/terminal-instances'

export interface SetupStateProps {
  cliName: string
  versions: {
    version: string
    tagName?: string
    tag_name?: string
    publishedAt?: string
    published_at?: string
  }[]
  selectedVersion: string | null
  currentVersion?: string | null
  isLoading: boolean
  onVersionChange: (version: string) => void
  onInstall: () => void
}

export function SetupState({
  cliName,
  versions,
  selectedVersion,
  currentVersion,
  isLoading,
  onVersionChange,
  onInstall,
}: SetupStateProps) {
  return (
    <div className="space-y-6">
      {currentVersion && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <CheckCircle2 className="size-4 text-green-500" />
          <span className="text-sm">
            Currently installed:{' '}
            <span className="font-medium">v{currentVersion}</span>
          </span>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Select Version
        </label>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading versions...
          </div>
        ) : (
          <Select
            value={selectedVersion ?? undefined}
            onValueChange={onVersionChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a version" />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v, index) => (
                <SelectItem key={v.version} value={v.version}>
                  v{v.version}
                  {index === 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (latest)
                    </span>
                  )}
                  {currentVersion === v.version && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (current)
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          {cliName} will be installed separately in Jean&apos;s application data
          folder — it won&apos;t affect your global installation. Authentication
          and configuration from your global {cliName} setup will be used.
        </p>
      </div>

      <Button
        onClick={onInstall}
        disabled={!selectedVersion || isLoading}
        className="w-full"
        size="lg"
      >
        <Download className="size-4" />
        {currentVersion ? 'Install Selected Version' : `Install ${cliName}`}
      </Button>
    </div>
  )
}

export interface InstallingStateProps {
  cliName: string
  progress: { stage: string; message: string; percent: number } | null
}

export function InstallingState({ cliName, progress }: InstallingStateProps) {
  const message = progress?.message ?? 'Preparing installation...'
  const percent = progress?.percent ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="size-10 animate-spin text-primary" />
        <div className="text-center">
          <p className="font-medium">{message}</p>
          <p className="text-sm text-muted-foreground mt-1">
            Please wait while {cliName} is being installed...
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-secondary rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export interface ErrorStateProps {
  cliName: string
  error: Error | null
  onRetry: () => void
  onSkip?: () => void
}

export function ErrorState({
  cliName: _cliName,
  error,
  onRetry,
  onSkip,
}: ErrorStateProps) {
  const errorMessage = error instanceof Error ? error.message : String(error)

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4">
        <AlertCircle className="size-10 text-destructive" />
        <div className="text-center">
          <p className="font-medium text-destructive">Installation Failed</p>
          <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={onRetry} className="w-full" size="lg">
          Try Again
        </Button>
        {onSkip && (
          <Button
            onClick={onSkip}
            variant="outline"
            className="w-full"
            size="lg"
          >
            Skip for Now
          </Button>
        )}
      </div>
    </div>
  )
}

export interface AuthCheckingStateProps {
  cliName: string
}

export function AuthCheckingState({ cliName }: AuthCheckingStateProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="size-10 animate-spin text-primary" />
        <div className="text-center">
          <p className="font-medium">Checking Authentication</p>
          <p className="text-sm text-muted-foreground mt-1">
            Verifying {cliName} login status...
          </p>
        </div>
      </div>
    </div>
  )
}

export interface AuthLoginStateProps {
  cliName: string
  terminalId: string
  command: string
  onComplete: () => void
  onSkip?: () => void
}

export function AuthLoginState({
  cliName,
  terminalId,
  command,
  onComplete,
  onSkip,
}: AuthLoginStateProps) {
  const observerRef = useRef<ResizeObserver | null>(null)
  const initialized = useRef(false)

  const { initTerminal, fit } = useTerminal({
    terminalId,
    worktreeId: 'cli-login',
    worktreePath: '/tmp',
    command,
  })

  const containerCallbackRef = useCallback(
    (container: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }

      if (!container) return

      const observer = new ResizeObserver(entries => {
        const entry = entries[0]
        if (!entry || entry.contentRect.width === 0) return

        if (!initialized.current) {
          initialized.current = true
          initTerminal(container)
          return
        }

        fit()
      })

      observer.observe(container)
      observerRef.current = observer
    },
    [initTerminal, fit]
  )

  // Auto-advance when the auth process exits successfully
  useEffect(() => {
    setOnStopped(terminalId, exitCode => {
      if (exitCode === 0) {
        // Brief delay so user can see the success output
        setTimeout(() => onComplete(), 1500)
      }
    })
    return () => setOnStopped(terminalId, undefined)
  }, [terminalId, onComplete])

  // Cleanup observer and terminal on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
      invoke('stop_terminal', { terminalId }).catch(() => {
        /* noop */
      })
      disposeTerminal(terminalId)
    }
  }, [terminalId])

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="font-medium">{cliName} Login Required</p>
        <p className="text-sm text-muted-foreground mt-1">
          Complete the authentication process below.
        </p>
      </div>

      <div
        ref={containerCallbackRef}
        className="w-full h-[300px] rounded-md bg-[#1a1a1a] overflow-hidden"
      />

      <div className="flex gap-2">
        <Button onClick={onComplete} className="flex-1" size="lg">
          I&apos;ve Completed Login
        </Button>
        {onSkip && (
          <Button
            onClick={onSkip}
            variant="outline"
            className="flex-1"
            size="lg"
          >
            Skip for Now
          </Button>
        )}
      </div>
    </div>
  )
}
