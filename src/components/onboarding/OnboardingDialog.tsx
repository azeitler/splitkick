/**
 * Onboarding Dialog for CLI Setup
 *
 * Multi-step wizard that handles installation and authentication of both
 * Claude CLI and GitHub CLI. Shows on first launch when either CLI is not
 * installed or not authenticated.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { CheckCircle2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/store/ui-store'
import { useClaudeCliSetup, useClaudeCliAuth } from '@/services/claude-cli'
import { useGhCliSetup, useGhCliAuth } from '@/services/gh-cli'
import {
  SetupState,
  InstallingState,
  ErrorState,
  AuthCheckingState,
  AuthLoginState,
} from './CliSetupComponents'
import { toast } from 'sonner'
import type { ReleaseInfo } from '@/types/claude-cli'
import type { GhReleaseInfo } from '@/types/gh-cli'

type OnboardingStep =
  | 'claude-setup'
  | 'claude-installing'
  | 'claude-auth-checking'
  | 'claude-auth-login'
  | 'gh-setup'
  | 'gh-installing'
  | 'gh-auth-checking'
  | 'gh-auth-login'
  | 'complete'

interface CliSetupData {
  type: 'claude' | 'gh'
  title: string
  description: string
  versions: (ReleaseInfo | GhReleaseInfo)[]
  isVersionsLoading: boolean
  isInstalling: boolean
  installError: Error | null
  progress: { stage: string; message: string; percent: number } | null
  install: (
    version: string,
    options?: { onSuccess?: () => void; onError?: (error: Error) => void }
  ) => void
  currentVersion: string | null | undefined
}

/**
 * Wrapper that only renders content when open.
 * Prevents duplicate event listeners when dialog is closed.
 */
export function OnboardingDialog() {
  const onboardingOpen = useUIStore(state => state.onboardingOpen)

  if (!onboardingOpen) {
    return null
  }

  return <OnboardingDialogContent />
}

/**
 * Inner component with all hook logic.
 * Only mounted when dialog is actually open.
 */
function OnboardingDialogContent() {
  const {
    onboardingOpen,
    setOnboardingOpen,
    onboardingStartStep,
    setOnboardingStartStep,
  } = useUIStore()

  const claudeSetup = useClaudeCliSetup()
  const ghSetup = useGhCliSetup()

  // Auth hooks — only enabled when CLI is installed
  const claudeAuth = useClaudeCliAuth({
    enabled: !!claudeSetup.status?.installed,
  })
  const ghAuth = useGhCliAuth({
    enabled: !!ghSetup.status?.installed,
  })

  const [step, setStep] = useState<OnboardingStep>('claude-setup')
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null)
  const [ghVersion, setGhVersion] = useState<string | null>(null)
  const [claudeInstallFailed, setClaudeInstallFailed] = useState(false)
  const [ghInstallFailed, setGhInstallFailed] = useState(false)
  // Track when step was deliberately set via onboardingStartStep to prevent auto-skip
  const deliberateStepRef = useRef(false)

  // Stable terminal IDs for auth login steps (created once per dialog open)
  const claudeLoginTerminalId = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => `onboarding-claude-login-${Date.now()}`,
    []
  )
  const ghLoginTerminalId = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => `onboarding-gh-login-${Date.now()}`,
    []
  )

  // Filter to stable releases only
  const stableClaudeVersions = claudeSetup.versions.filter(v => !v.prerelease)
  const stableGhVersions = ghSetup.versions.filter(v => !v.prerelease)

  // Auto-select latest versions when loaded
  useEffect(() => {
    if (!claudeVersion && stableClaudeVersions.length > 0) {
      queueMicrotask(() =>
        setClaudeVersion(stableClaudeVersions[0]?.version ?? null)
      )
    }
  }, [claudeVersion, stableClaudeVersions])

  useEffect(() => {
    if (!ghVersion && stableGhVersions.length > 0) {
      queueMicrotask(() => setGhVersion(stableGhVersions[0]?.version ?? null))
    }
  }, [ghVersion, stableGhVersions])

  // Helper: determine next step after Claude is installed + authenticated
  const getNextStepAfterClaude = useCallback(() => {
    if (!ghSetup.status?.installed) return 'gh-setup' as const
    if (!ghAuth.data?.authenticated) return 'gh-auth-checking' as const
    return 'complete' as const
  }, [ghSetup.status?.installed, ghAuth.data?.authenticated])

  // Helper: determine next step after gh is installed + authenticated
  const getNextStepAfterGh = useCallback(() => {
    return 'complete' as const
  }, [])

  // Determine initial step when dialog opens
  useEffect(() => {
    if (!onboardingOpen) {
      // Reset ref when dialog closes
      deliberateStepRef.current = false
      return
    }

    // Reset error states on open
    queueMicrotask(() => {
      setClaudeInstallFailed(false)
      setGhInstallFailed(false)
    })

    // If a specific start step was requested (from Settings)
    if (onboardingStartStep === 'gh') {
      deliberateStepRef.current = true
      queueMicrotask(() => {
        setStep('gh-setup')
        setOnboardingStartStep(null)
      })
      return
    }

    if (onboardingStartStep === 'claude') {
      deliberateStepRef.current = true
      queueMicrotask(() => {
        setStep('claude-setup')
        setOnboardingStartStep(null)
      })
      return
    }

    // Skip auto-skip logic if step was deliberately set
    if (deliberateStepRef.current) {
      return
    }

    // Auto-skip based on installation + auth status
    const claudeInstalled = claudeSetup.status?.installed
    const ghInstalled = ghSetup.status?.installed
    const claudeAuthed = claudeAuth.data?.authenticated
    const ghAuthed = ghAuth.data?.authenticated

    if (claudeInstalled && ghInstalled) {
      if (claudeAuthed && ghAuthed) {
        queueMicrotask(() => setStep('complete'))
      } else if (!claudeAuthed) {
        queueMicrotask(() => setStep('claude-auth-checking'))
      } else {
        queueMicrotask(() => setStep('gh-auth-checking'))
      }
    } else if (claudeInstalled) {
      if (claudeAuthed) {
        queueMicrotask(() => setStep('gh-setup'))
      } else {
        queueMicrotask(() => setStep('claude-auth-checking'))
      }
    } else {
      queueMicrotask(() => setStep('claude-setup'))
    }
  }, [
    onboardingOpen,
    onboardingStartStep,
    claudeSetup.status?.installed,
    ghSetup.status?.installed,
    claudeAuth.data?.authenticated,
    ghAuth.data?.authenticated,
    setOnboardingStartStep,
  ])

  // Handle Claude auth check result
  useEffect(() => {
    if (step !== 'claude-auth-checking') return
    if (claudeAuth.isLoading || claudeAuth.isFetching) return

    if (claudeAuth.data?.authenticated) {
      queueMicrotask(() => setStep(getNextStepAfterClaude()))
    } else {
      queueMicrotask(() => setStep('claude-auth-login'))
    }
  }, [
    step,
    claudeAuth.isLoading,
    claudeAuth.isFetching,
    claudeAuth.data?.authenticated,
    getNextStepAfterClaude,
  ])

  // Handle gh auth check result
  useEffect(() => {
    if (step !== 'gh-auth-checking') return
    if (ghAuth.isLoading || ghAuth.isFetching) return

    if (ghAuth.data?.authenticated) {
      queueMicrotask(() => setStep(getNextStepAfterGh()))
    } else {
      queueMicrotask(() => setStep('gh-auth-login'))
    }
  }, [
    step,
    ghAuth.isLoading,
    ghAuth.isFetching,
    ghAuth.data?.authenticated,
    getNextStepAfterGh,
  ])

  const handleClaudeInstall = useCallback(() => {
    if (!claudeVersion) return
    setStep('claude-installing')
    claudeSetup.install(claudeVersion, {
      onSuccess: () => {
        // After install, check auth
        setStep('claude-auth-checking')
        claudeAuth.refetch()
      },
      onError: () => {
        setClaudeInstallFailed(true)
        setStep('claude-setup')
      },
    })
  }, [claudeVersion, claudeSetup, claudeAuth])

  const handleGhInstall = useCallback(() => {
    if (!ghVersion) return
    setStep('gh-installing')
    ghSetup.install(ghVersion, {
      onSuccess: () => {
        // After install, check auth
        setStep('gh-auth-checking')
        ghAuth.refetch()
      },
      onError: () => {
        setGhInstallFailed(true)
        setStep('gh-setup')
      },
    })
  }, [ghVersion, ghSetup, ghAuth])

  const handleClaudeLoginComplete = useCallback(async () => {
    setStep('claude-auth-checking')
    await claudeAuth.refetch()
  }, [claudeAuth])

  const handleGhLoginComplete = useCallback(async () => {
    setStep('gh-auth-checking')
    await ghAuth.refetch()
  }, [ghAuth])

  const handleGhLoginSkip = useCallback(() => {
    toast.info(
      'GitHub authentication skipped. You can authenticate later in Settings.'
    )
    setStep('complete')
  }, [])

  const handleComplete = useCallback(() => {
    claudeSetup.refetchStatus()
    ghSetup.refetchStatus()
    setOnboardingOpen(false)
    setOnboardingStartStep(null)
  }, [claudeSetup, ghSetup, setOnboardingOpen, setOnboardingStartStep])

  const handleAbort = useCallback(() => {
    const claudeReady =
      claudeSetup.status?.installed && claudeAuth.data?.authenticated
    setOnboardingOpen(false)
    setOnboardingStartStep(null)
    if (!claudeReady) {
      toast.warning(
        'Setup incomplete. Jean requires Claude CLI to function. Reopen from Settings.'
      )
    } else {
      toast.info(
        'GitHub authentication skipped. You can authenticate later in Settings.'
      )
    }
  }, [
    claudeSetup.status?.installed,
    claudeAuth.data?.authenticated,
    setOnboardingOpen,
    setOnboardingStartStep,
  ])

  const handleSkipGh = useCallback(() => {
    // Only available on error - graceful fallback
    setStep('complete')
  }, [])

  // Build CLI setup data based on current step
  const getCliSetupData = (): CliSetupData | null => {
    if (step === 'claude-setup' || step === 'claude-installing') {
      return {
        type: 'claude',
        title: 'Claude CLI',
        description: 'Claude CLI is required for AI chat functionality.',
        versions: stableClaudeVersions,
        isVersionsLoading: claudeSetup.isVersionsLoading,
        isInstalling: claudeSetup.isInstalling,
        installError: claudeInstallFailed ? claudeSetup.installError : null,
        progress: claudeSetup.progress,
        install: claudeSetup.install,
        currentVersion: claudeSetup.status?.version,
      }
    }

    if (step === 'gh-setup' || step === 'gh-installing') {
      return {
        type: 'gh',
        title: 'GitHub CLI',
        description: 'GitHub CLI is required for GitHub integration.',
        versions: stableGhVersions,
        isVersionsLoading: ghSetup.isVersionsLoading,
        isInstalling: ghSetup.isInstalling,
        installError: ghInstallFailed ? ghSetup.installError : null,
        progress: ghSetup.progress,
        install: ghSetup.install,
        currentVersion: ghSetup.status?.version,
      }
    }

    return null
  }

  const cliData = getCliSetupData()

  // Determine if we're in reinstall mode (CLI already installed but user wants to change version)
  const isClaudeReinstall =
    claudeSetup.status?.installed && step === 'claude-setup'
  const isGhReinstall = ghSetup.status?.installed && step === 'gh-setup'

  // Build CLI login command from binary path
  const claudeLoginCommand = claudeSetup.status?.path
    ? `'${claudeSetup.status.path.replace(/'/g, "'\\''")}'`
    : ''
  const ghLoginCommand = ghSetup.status?.path
    ? `'${ghSetup.status.path.replace(/'/g, "'\\''")}' auth login`
    : ''

  // Determine dialog title and description
  const getDialogContent = () => {
    if (step === 'complete') {
      return {
        title: 'Setup Complete',
        description:
          'All required tools have been installed and authenticated.',
      }
    }

    if (step === 'claude-setup' || step === 'claude-installing') {
      return {
        title: isClaudeReinstall
          ? 'Change Claude CLI Version'
          : 'Welcome to Jean',
        description: isClaudeReinstall
          ? 'Select a version to install. This will replace the current installation.'
          : 'Jean needs Claude CLI to work. Please install it to continue.',
      }
    }

    if (step === 'claude-auth-checking' || step === 'claude-auth-login') {
      return {
        title: 'Authenticate Claude CLI',
        description: 'Claude CLI requires authentication to function.',
      }
    }

    if (step === 'gh-setup' || step === 'gh-installing') {
      return {
        title: isGhReinstall
          ? 'Change GitHub CLI Version'
          : 'Install GitHub CLI',
        description: isGhReinstall
          ? 'Select a version to install. This will replace the current installation.'
          : 'GitHub CLI is required for GitHub integration.',
      }
    }

    if (step === 'gh-auth-checking' || step === 'gh-auth-login') {
      return {
        title: 'Authenticate GitHub CLI',
        description: 'Authenticate GitHub CLI for full functionality.',
      }
    }

    return { title: 'Setup', description: '' }
  }

  const dialogContent = getDialogContent()

  // Step indicator
  const renderStepIndicator = () => {
    const isClaudeStep = step.startsWith('claude-')
    const isGhStep = step.startsWith('gh-')
    const claudeComplete = !isClaudeStep && (isGhStep || step === 'complete')
    const ghComplete = step === 'complete'

    return (
      <div className="flex items-center justify-center gap-2 mb-4">
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            isClaudeStep
              ? 'bg-primary text-primary-foreground'
              : claudeComplete
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {claudeComplete ? (
            <CheckCircle2 className="size-3" />
          ) : (
            <span className="font-medium">1</span>
          )}
          <span>Claude CLI</span>
        </div>
        <div className="w-4 h-px bg-border" />
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            isGhStep
              ? 'bg-primary text-primary-foreground'
              : ghComplete
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {ghComplete ? (
            <CheckCircle2 className="size-3" />
          ) : (
            <span className="font-medium">2</span>
          )}
          <span>GitHub CLI</span>
        </div>
        <div className="w-4 h-px bg-border" />
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            step === 'complete'
              ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {step === 'complete' ? (
            <CheckCircle2 className="size-3" />
          ) : (
            <span className="font-medium">3</span>
          )}
          <span>Done</span>
        </div>
      </div>
    )
  }

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (step === 'complete') {
          handleComplete()
        } else {
          handleAbort()
        }
      }
    },
    [step, handleComplete, handleAbort]
  )

  return (
    <Dialog open={onboardingOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{dialogContent.title}</DialogTitle>
          <DialogDescription>{dialogContent.description}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {renderStepIndicator()}

          {step === 'complete' ? (
            <SuccessState
              claudeVersion={claudeSetup.status?.version}
              ghVersion={ghSetup.status?.version}
              onContinue={handleComplete}
            />
          ) : step === 'claude-installing' && cliData ? (
            <InstallingState cliName="Claude CLI" progress={cliData.progress} />
          ) : step === 'gh-installing' && cliData ? (
            <InstallingState cliName="GitHub CLI" progress={cliData.progress} />
          ) : step === 'claude-auth-checking' ? (
            <AuthCheckingState cliName="Claude CLI" />
          ) : step === 'claude-auth-login' ? (
            <AuthLoginState
              cliName="Claude CLI"
              terminalId={claudeLoginTerminalId}
              command={claudeLoginCommand}
              onComplete={handleClaudeLoginComplete}
            />
          ) : step === 'gh-auth-checking' ? (
            <AuthCheckingState cliName="GitHub CLI" />
          ) : step === 'gh-auth-login' ? (
            <AuthLoginState
              cliName="GitHub CLI"
              terminalId={ghLoginTerminalId}
              command={ghLoginCommand}
              onComplete={handleGhLoginComplete}
              onSkip={handleGhLoginSkip}
            />
          ) : step === 'claude-setup' && cliData ? (
            claudeInstallFailed && cliData.installError ? (
              <ErrorState
                cliName="Claude CLI"
                error={cliData.installError}
                onRetry={handleClaudeInstall}
              />
            ) : (
              <SetupState
                cliName="Claude CLI"
                versions={stableClaudeVersions}
                selectedVersion={claudeVersion}
                currentVersion={
                  isClaudeReinstall ? cliData.currentVersion : null
                }
                isLoading={cliData.isVersionsLoading}
                onVersionChange={setClaudeVersion}
                onInstall={handleClaudeInstall}
              />
            )
          ) : step === 'gh-setup' && cliData ? (
            ghInstallFailed && cliData.installError ? (
              <ErrorState
                cliName="GitHub CLI"
                error={cliData.installError}
                onRetry={handleGhInstall}
                onSkip={handleSkipGh}
              />
            ) : (
              <SetupState
                cliName="GitHub CLI"
                versions={stableGhVersions}
                selectedVersion={ghVersion}
                currentVersion={isGhReinstall ? cliData.currentVersion : null}
                isLoading={cliData.isVersionsLoading}
                onVersionChange={setGhVersion}
                onInstall={handleGhInstall}
              />
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface SuccessStateProps {
  claudeVersion: string | null | undefined
  ghVersion: string | null | undefined
  onContinue: () => void
}

function SuccessState({
  claudeVersion,
  ghVersion,
  onContinue,
}: SuccessStateProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4">
        <CheckCircle2 className="size-10 text-green-500" />
        <div className="text-center">
          <p className="font-medium">All Tools Ready</p>
          <div className="text-sm text-muted-foreground mt-2 space-y-1">
            {claudeVersion && <p>Claude CLI: v{claudeVersion}</p>}
            {ghVersion && <p>GitHub CLI: v{ghVersion}</p>}
            {!claudeVersion && !ghVersion && <p>Setup complete</p>}
          </div>
        </div>
      </div>

      <Button onClick={onContinue} className="w-full" size="lg">
        Continue to Jean
      </Button>
    </div>
  )
}

export default OnboardingDialog
