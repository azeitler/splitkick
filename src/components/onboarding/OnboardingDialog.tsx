/**
 * Onboarding Dialog for CLI Setup
 *
 * Multi-step wizard that handles installation and authentication of at least
 * one AI backend CLI (Claude/Codex/OpenCode) plus mandatory GitHub CLI.
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
import { Checkbox } from '@/components/ui/checkbox'
import { useUIStore } from '@/store/ui-store'
import { useClaudeCliSetup, useClaudeCliAuth } from '@/services/claude-cli'
import { useCodexCliSetup, useCodexCliAuth } from '@/services/codex-cli'
import { useOpenCodeCliSetup, useOpenCodeCliAuth } from '@/services/opencode-cli'
import { useGhCliSetup, useGhCliAuth } from '@/services/gh-cli'
import {
  SetupState,
  InstallingState,
  ErrorState,
  AuthCheckingState,
  AuthLoginState,
} from './CliSetupComponents'
import { toast } from 'sonner'

type AIBackend = 'claude' | 'codex' | 'opencode'
type CliType = AIBackend | 'gh'

const AI_BACKENDS: AIBackend[] = ['claude', 'codex', 'opencode']

type OnboardingStep =
  | 'backend-select'
  | 'claude-setup'
  | 'claude-installing'
  | 'claude-auth-checking'
  | 'claude-auth-login'
  | 'codex-setup'
  | 'codex-installing'
  | 'codex-auth-checking'
  | 'codex-auth-login'
  | 'opencode-setup'
  | 'opencode-installing'
  | 'opencode-auth-checking'
  | 'opencode-auth-login'
  | 'gh-setup'
  | 'gh-installing'
  | 'gh-auth-checking'
  | 'gh-auth-login'
  | 'complete'

interface VersionOption {
  version: string
  prerelease: boolean
  tagName?: string
  tag_name?: string
  publishedAt?: string
  published_at?: string
}

interface CliSetupData {
  type: CliType
  title: string
  description: string
  versions: VersionOption[]
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

const backendLabel: Record<CliType, string> = {
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  opencode: 'OpenCode CLI',
  gh: 'GitHub CLI',
}

function stepToBackend(step: OnboardingStep): AIBackend | null {
  if (step.startsWith('claude-')) return 'claude'
  if (step.startsWith('codex-')) return 'codex'
  if (step.startsWith('opencode-')) return 'opencode'
  return null
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
  const codexSetup = useCodexCliSetup()
  const opencodeSetup = useOpenCodeCliSetup()
  const ghSetup = useGhCliSetup()

  const claudeAuth = useClaudeCliAuth({ enabled: !!claudeSetup.status?.installed })
  const codexAuth = useCodexCliAuth({ enabled: !!codexSetup.status?.installed })
  const opencodeAuth = useOpenCodeCliAuth({ enabled: !!opencodeSetup.status?.installed })
  const ghAuth = useGhCliAuth({ enabled: !!ghSetup.status?.installed })

  const [step, setStep] = useState<OnboardingStep>('backend-select')
  const [selectedBackends, setSelectedBackends] = useState<AIBackend[]>([])
  const [activeBackendIndex, setActiveBackendIndex] = useState(0)

  const [claudeVersion, setClaudeVersion] = useState<string | null>(null)
  const [codexVersion, setCodexVersion] = useState<string | null>(null)
  const [opencodeVersion, setOpencodeVersion] = useState<string | null>(null)
  const [ghVersion, setGhVersion] = useState<string | null>(null)

  const [claudeInstallFailed, setClaudeInstallFailed] = useState(false)
  const [codexInstallFailed, setCodexInstallFailed] = useState(false)
  const [opencodeInstallFailed, setOpencodeInstallFailed] = useState(false)
  const [ghInstallFailed, setGhInstallFailed] = useState(false)

  const initializedFlowRef = useRef(false)

  // Stable terminal IDs for auth login steps (created once per dialog open)
  const claudeLoginTerminalId = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => `onboarding-claude-login-${Date.now()}`,
    []
  )
  const codexLoginTerminalId = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => `onboarding-codex-login-${Date.now()}`,
    []
  )
  const opencodeLoginTerminalId = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => `onboarding-opencode-login-${Date.now()}`,
    []
  )
  const ghLoginTerminalId = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => `onboarding-gh-login-${Date.now()}`,
    []
  )

  const stableClaudeVersions = claudeSetup.versions.filter(v => !v.prerelease)
  const stableCodexVersions = codexSetup.versions.filter(v => !v.prerelease)
  const stableOpencodeVersions = opencodeSetup.versions.filter(v => !v.prerelease)
  const stableGhVersions = ghSetup.versions.filter(v => !v.prerelease)

  useEffect(() => {
    if (!claudeVersion && stableClaudeVersions.length > 0) {
      queueMicrotask(() =>
        setClaudeVersion(stableClaudeVersions[0]?.version ?? null)
      )
    }
  }, [claudeVersion, stableClaudeVersions])

  useEffect(() => {
    if (!codexVersion && stableCodexVersions.length > 0) {
      queueMicrotask(() => setCodexVersion(stableCodexVersions[0]?.version ?? null))
    }
  }, [codexVersion, stableCodexVersions])

  useEffect(() => {
    if (!opencodeVersion && stableOpencodeVersions.length > 0) {
      queueMicrotask(() =>
        setOpencodeVersion(stableOpencodeVersions[0]?.version ?? null)
      )
    }
  }, [opencodeVersion, stableOpencodeVersions])

  useEffect(() => {
    if (!ghVersion && stableGhVersions.length > 0) {
      queueMicrotask(() => setGhVersion(stableGhVersions[0]?.version ?? null))
    }
  }, [ghVersion, stableGhVersions])

  const isBackendReady = useCallback(
    (backend: AIBackend) => {
      if (backend === 'claude') {
        return !!claudeSetup.status?.installed && !!claudeAuth.data?.authenticated
      }
      if (backend === 'codex') {
        return !!codexSetup.status?.installed && !!codexAuth.data?.authenticated
      }
      return (
        !!opencodeSetup.status?.installed && !!opencodeAuth.data?.authenticated
      )
    },
    [
      claudeSetup.status?.installed,
      claudeAuth.data?.authenticated,
      codexSetup.status?.installed,
      codexAuth.data?.authenticated,
      opencodeSetup.status?.installed,
      opencodeAuth.data?.authenticated,
    ]
  )

  const getNextStepForBackend = useCallback(
    (backend: AIBackend): OnboardingStep | null => {
      if (backend === 'claude') {
        if (!claudeSetup.status?.installed) return 'claude-setup'
        if (!claudeAuth.data?.authenticated) return 'claude-auth-checking'
        return null
      }
      if (backend === 'codex') {
        if (!codexSetup.status?.installed) return 'codex-setup'
        if (!codexAuth.data?.authenticated) return 'codex-auth-checking'
        return null
      }

      if (!opencodeSetup.status?.installed) return 'opencode-setup'
      if (!opencodeAuth.data?.authenticated) return 'opencode-auth-checking'
      return null
    },
    [
      claudeSetup.status?.installed,
      claudeAuth.data?.authenticated,
      codexSetup.status?.installed,
      codexAuth.data?.authenticated,
      opencodeSetup.status?.installed,
      opencodeAuth.data?.authenticated,
    ]
  )

  const getNextStepAfterBackends = useCallback((): OnboardingStep => {
    if (!ghSetup.status?.installed) return 'gh-setup'
    if (!ghAuth.data?.authenticated) return 'gh-auth-checking'
    return 'complete'
  }, [ghSetup.status?.installed, ghAuth.data?.authenticated])

  const moveToNextBackendOrGh = useCallback(
    (currentBackend: AIBackend) => {
      const currentIndex = selectedBackends.indexOf(currentBackend)
      for (let i = currentIndex + 1; i < selectedBackends.length; i += 1) {
        const backend = selectedBackends[i]
        if (!backend) continue
        const nextStep = getNextStepForBackend(backend)
        if (nextStep) {
          setActiveBackendIndex(i)
          setStep(nextStep)
          return
        }
      }

      setStep(getNextStepAfterBackends())
    },
    [selectedBackends, getNextStepForBackend, getNextStepAfterBackends]
  )

  const loadingInitialState =
    claudeSetup.isStatusLoading ||
    codexSetup.isStatusLoading ||
    opencodeSetup.isStatusLoading ||
    ghSetup.isStatusLoading ||
    (claudeSetup.status?.installed && (claudeAuth.isLoading || claudeAuth.isFetching)) ||
    (codexSetup.status?.installed && (codexAuth.isLoading || codexAuth.isFetching)) ||
    (opencodeSetup.status?.installed &&
      (opencodeAuth.isLoading || opencodeAuth.isFetching)) ||
    (ghSetup.status?.installed && (ghAuth.isLoading || ghAuth.isFetching))

  useEffect(() => {
    if (!onboardingOpen) {
      initializedFlowRef.current = false
      return
    }

    if (loadingInitialState || initializedFlowRef.current) {
      return
    }

    initializedFlowRef.current = true

    queueMicrotask(() => {
      setClaudeInstallFailed(false)
      setCodexInstallFailed(false)
      setOpencodeInstallFailed(false)
      setGhInstallFailed(false)
    })

    if (onboardingStartStep === 'gh') {
      queueMicrotask(() => {
        setStep('gh-setup')
        setOnboardingStartStep(null)
      })
      return
    }

    if (onboardingStartStep === 'claude') {
      queueMicrotask(() => {
        setSelectedBackends(['claude'])
        setActiveBackendIndex(0)
        setStep('claude-setup')
        setOnboardingStartStep(null)
      })
      return
    }

    const readyBackends = AI_BACKENDS.filter(isBackendReady)
    const ghReady = !!ghSetup.status?.installed && !!ghAuth.data?.authenticated

    if (ghReady && readyBackends.length > 0) {
      queueMicrotask(() => setStep('complete'))
      return
    }

    if (readyBackends.length > 0) {
      queueMicrotask(() => {
        setSelectedBackends(readyBackends)
        setStep(getNextStepAfterBackends())
      })
      return
    }

    queueMicrotask(() => setStep('backend-select'))
  }, [
    onboardingOpen,
    onboardingStartStep,
    setOnboardingStartStep,
    loadingInitialState,
    isBackendReady,
    ghSetup.status?.installed,
    ghAuth.data?.authenticated,
    getNextStepAfterBackends,
  ])

  // Handle AI backend auth check steps
  useEffect(() => {
    if (step !== 'claude-auth-checking') return
    if (claudeAuth.isLoading || claudeAuth.isFetching) return

    if (claudeAuth.data?.authenticated) {
      queueMicrotask(() => moveToNextBackendOrGh('claude'))
    } else {
      queueMicrotask(() => setStep('claude-auth-login'))
    }
  }, [
    step,
    claudeAuth.isLoading,
    claudeAuth.isFetching,
    claudeAuth.data?.authenticated,
    moveToNextBackendOrGh,
  ])

  useEffect(() => {
    if (step !== 'codex-auth-checking') return
    if (codexAuth.isLoading || codexAuth.isFetching) return

    if (codexAuth.data?.authenticated) {
      queueMicrotask(() => moveToNextBackendOrGh('codex'))
    } else {
      queueMicrotask(() => setStep('codex-auth-login'))
    }
  }, [
    step,
    codexAuth.isLoading,
    codexAuth.isFetching,
    codexAuth.data?.authenticated,
    moveToNextBackendOrGh,
  ])

  useEffect(() => {
    if (step !== 'opencode-auth-checking') return
    if (opencodeAuth.isLoading || opencodeAuth.isFetching) return

    if (opencodeAuth.data?.authenticated) {
      queueMicrotask(() => moveToNextBackendOrGh('opencode'))
    } else {
      queueMicrotask(() => setStep('opencode-auth-login'))
    }
  }, [
    step,
    opencodeAuth.isLoading,
    opencodeAuth.isFetching,
    opencodeAuth.data?.authenticated,
    moveToNextBackendOrGh,
  ])

  useEffect(() => {
    if (step !== 'gh-auth-checking') return
    if (ghAuth.isLoading || ghAuth.isFetching) return

    if (ghAuth.data?.authenticated) {
      queueMicrotask(() => setStep('complete'))
    } else {
      queueMicrotask(() => setStep('gh-auth-login'))
    }
  }, [step, ghAuth.isLoading, ghAuth.isFetching, ghAuth.data?.authenticated])

  const handleBackendToggle = useCallback((backend: AIBackend, checked: boolean) => {
    setSelectedBackends(prev => {
      if (checked) {
        if (prev.includes(backend)) return prev
        return [...prev, backend]
      }
      return prev.filter(b => b !== backend)
    })
  }, [])

  const handleBackendSelectionContinue = useCallback(() => {
    if (selectedBackends.length === 0) {
      toast.warning('Select at least one AI backend to continue.')
      return
    }

    for (let i = 0; i < selectedBackends.length; i += 1) {
      const backend = selectedBackends[i]
      if (!backend) continue
      const nextStep = getNextStepForBackend(backend)
      if (nextStep) {
        setActiveBackendIndex(i)
        setStep(nextStep)
        return
      }
    }

    setStep(getNextStepAfterBackends())
  }, [selectedBackends, getNextStepForBackend, getNextStepAfterBackends])

  const handleClaudeInstall = useCallback(() => {
    if (!claudeVersion) return
    setStep('claude-installing')
    claudeSetup.install(claudeVersion, {
      onSuccess: () => {
        setStep('claude-auth-checking')
        claudeAuth.refetch()
      },
      onError: () => {
        setClaudeInstallFailed(true)
        setStep('claude-setup')
      },
    })
  }, [claudeVersion, claudeSetup, claudeAuth])

  const handleCodexInstall = useCallback(() => {
    if (!codexVersion) return
    setStep('codex-installing')
    codexSetup.install(codexVersion, {
      onSuccess: () => {
        setStep('codex-auth-checking')
        codexAuth.refetch()
      },
      onError: () => {
        setCodexInstallFailed(true)
        setStep('codex-setup')
      },
    })
  }, [codexVersion, codexSetup, codexAuth])

  const handleOpencodeInstall = useCallback(() => {
    if (!opencodeVersion) return
    setStep('opencode-installing')
    opencodeSetup.install(opencodeVersion, {
      onSuccess: () => {
        setStep('opencode-auth-checking')
        opencodeAuth.refetch()
      },
      onError: () => {
        setOpencodeInstallFailed(true)
        setStep('opencode-setup')
      },
    })
  }, [opencodeVersion, opencodeSetup, opencodeAuth])

  const handleGhInstall = useCallback(() => {
    if (!ghVersion) return
    setStep('gh-installing')
    ghSetup.install(ghVersion, {
      onSuccess: () => {
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

  const handleCodexLoginComplete = useCallback(async () => {
    setStep('codex-auth-checking')
    await codexAuth.refetch()
  }, [codexAuth])

  const handleOpencodeLoginComplete = useCallback(async () => {
    setStep('opencode-auth-checking')
    await opencodeAuth.refetch()
  }, [opencodeAuth])

  const handleGhLoginComplete = useCallback(async () => {
    setStep('gh-auth-checking')
    await ghAuth.refetch()
  }, [ghAuth])

  const handleComplete = useCallback(() => {
    claudeSetup.refetchStatus()
    codexSetup.refetchStatus()
    opencodeSetup.refetchStatus()
    ghSetup.refetchStatus()
    setOnboardingOpen(false)
    setOnboardingStartStep(null)
  }, [
    claudeSetup,
    codexSetup,
    opencodeSetup,
    ghSetup,
    setOnboardingOpen,
    setOnboardingStartStep,
  ])

  const handleAbort = useCallback(() => {
    const ghReady = !!ghSetup.status?.installed && !!ghAuth.data?.authenticated
    const hasBackendReady =
      !!(claudeSetup.status?.installed && claudeAuth.data?.authenticated) ||
      !!(codexSetup.status?.installed && codexAuth.data?.authenticated) ||
      !!(opencodeSetup.status?.installed && opencodeAuth.data?.authenticated)

    setOnboardingOpen(false)
    setOnboardingStartStep(null)

    if (!ghReady || !hasBackendReady) {
      toast.warning(
        'Setup incomplete. Jean requires GitHub CLI and at least one AI backend CLI.'
      )
    }
  }, [
    ghSetup.status?.installed,
    ghAuth.data?.authenticated,
    claudeSetup.status?.installed,
    claudeAuth.data?.authenticated,
    codexSetup.status?.installed,
    codexAuth.data?.authenticated,
    opencodeSetup.status?.installed,
    opencodeAuth.data?.authenticated,
    setOnboardingOpen,
    setOnboardingStartStep,
  ])

  const getCliSetupData = (): CliSetupData | null => {
    if (step === 'claude-setup' || step === 'claude-installing') {
      return {
        type: 'claude',
        title: 'Claude CLI',
        description: 'Claude CLI enables Anthropic-backed AI sessions.',
        versions: stableClaudeVersions,
        isVersionsLoading: claudeSetup.isVersionsLoading,
        isInstalling: claudeSetup.isInstalling,
        installError: claudeInstallFailed ? claudeSetup.installError : null,
        progress: claudeSetup.progress,
        install: claudeSetup.install,
        currentVersion: claudeSetup.status?.version,
      }
    }

    if (step === 'codex-setup' || step === 'codex-installing') {
      return {
        type: 'codex',
        title: 'Codex CLI',
        description: 'Codex CLI enables OpenAI-backed AI sessions.',
        versions: stableCodexVersions,
        isVersionsLoading: codexSetup.isVersionsLoading,
        isInstalling: codexSetup.isInstalling,
        installError: codexInstallFailed ? codexSetup.installError : null,
        progress: codexSetup.progress,
        install: codexSetup.install,
        currentVersion: codexSetup.status?.version,
      }
    }

    if (step === 'opencode-setup' || step === 'opencode-installing') {
      return {
        type: 'opencode',
        title: 'OpenCode CLI',
        description: 'OpenCode CLI enables OpenCode-backed AI sessions.',
        versions: stableOpencodeVersions,
        isVersionsLoading: opencodeSetup.isVersionsLoading,
        isInstalling: opencodeSetup.isInstalling,
        installError: opencodeInstallFailed ? opencodeSetup.installError : null,
        progress: opencodeSetup.progress,
        install: opencodeSetup.install,
        currentVersion: opencodeSetup.status?.version,
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

  const isClaudeReinstall = claudeSetup.status?.installed && step === 'claude-setup'
  const isCodexReinstall = codexSetup.status?.installed && step === 'codex-setup'
  const isOpencodeReinstall =
    opencodeSetup.status?.installed && step === 'opencode-setup'
  const isGhReinstall = ghSetup.status?.installed && step === 'gh-setup'

  const claudeLoginCommand = claudeSetup.status?.path
    ? `'${claudeSetup.status.path.replace(/'/g, "'\\''")}'` +
      (claudeSetup.status.supports_auth_command ? ' auth login' : '')
    : ''

  const codexLoginCommand = codexSetup.status?.path
    ? `'${codexSetup.status.path.replace(/'/g, "'\\''")}' login`
    : ''

  const opencodeLoginCommand = opencodeSetup.status?.path
    ? `'${opencodeSetup.status.path.replace(/'/g, "'\\''")}' auth login`
    : ''

  const ghLoginCommand = ghSetup.status?.path
    ? `'${ghSetup.status.path.replace(/'/g, "'\\''")}' auth login`
    : ''

  const getDialogContent = () => {
    if (step === 'backend-select') {
      return {
        title: 'Welcome to Jean',
        description:
          'Select at least one AI backend to install. GitHub CLI setup is required next.',
      }
    }

    if (step === 'complete') {
      return {
        title: 'Setup Complete',
        description:
          'All required tools have been installed and authenticated.',
      }
    }

    if (step === 'gh-setup' || step === 'gh-installing') {
      return {
        title: isGhReinstall ? 'Change GitHub CLI Version' : 'Install GitHub CLI',
        description: isGhReinstall
          ? 'Select a version to install. This will replace the current installation.'
          : 'GitHub CLI is required for GitHub integration.',
      }
    }

    if (step === 'gh-auth-checking' || step === 'gh-auth-login') {
      return {
        title: 'Authenticate GitHub CLI',
        description: 'GitHub CLI authentication is required to continue.',
      }
    }

    const currentBackend = stepToBackend(step)
    const backendName = currentBackend ? backendLabel[currentBackend] : 'AI Backend'

    if (
      step === 'claude-setup' ||
      step === 'claude-installing' ||
      step === 'codex-setup' ||
      step === 'codex-installing' ||
      step === 'opencode-setup' ||
      step === 'opencode-installing'
    ) {
      const isReinstall =
        (currentBackend === 'claude' && isClaudeReinstall) ||
        (currentBackend === 'codex' && isCodexReinstall) ||
        (currentBackend === 'opencode' && isOpencodeReinstall)

      return {
        title: isReinstall ? `Change ${backendName} Version` : `Install ${backendName}`,
        description: isReinstall
          ? 'Select a version to install. This will replace the current installation.'
          : `Install ${backendName} to enable this AI backend.`,
      }
    }

    if (
      step === 'claude-auth-checking' ||
      step === 'claude-auth-login' ||
      step === 'codex-auth-checking' ||
      step === 'codex-auth-login' ||
      step === 'opencode-auth-checking' ||
      step === 'opencode-auth-login'
    ) {
      return {
        title: `Authenticate ${backendName}`,
        description: `${backendName} requires authentication to function.`,
      }
    }

    return { title: 'Setup', description: '' }
  }

  const dialogContent = getDialogContent()

  const renderStepIndicator = () => {
    const isBackendSelection = step === 'backend-select'
    const isBackendStep =
      step.startsWith('claude-') ||
      step.startsWith('codex-') ||
      step.startsWith('opencode-')
    const isGhStep = step.startsWith('gh-')

    const backendComplete = !isBackendSelection && !isBackendStep
    const ghComplete = step === 'complete'

    return (
      <div className="flex items-center justify-center gap-2 mb-4">
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            isBackendSelection || isBackendStep
              ? 'bg-primary text-primary-foreground'
              : backendComplete
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {backendComplete ? (
            <CheckCircle2 className="size-3" />
          ) : (
            <span className="font-medium">1</span>
          )}
          <span>AI Backend(s)</span>
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

  const currentBackend =
    selectedBackends[activeBackendIndex] ?? selectedBackends[0] ?? null

  return (
    <Dialog open={onboardingOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[calc(100vw-4rem)] h-[calc(100vh-4rem)] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">{dialogContent.title}</DialogTitle>
          <DialogDescription>{dialogContent.description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {renderStepIndicator()}

          {step === 'backend-select' ? (
            <BackendSelectionState
              selectedBackends={selectedBackends}
              onToggle={handleBackendToggle}
              onContinue={handleBackendSelectionContinue}
            />
          ) : step === 'complete' ? (
            <SuccessState
              claudeVersion={claudeSetup.status?.version}
              codexVersion={codexSetup.status?.version}
              opencodeVersion={opencodeSetup.status?.version}
              ghVersion={ghSetup.status?.version}
              onContinue={handleComplete}
            />
          ) : step === 'claude-installing' && cliData ? (
            <InstallingState cliName="Claude CLI" progress={cliData.progress} />
          ) : step === 'codex-installing' && cliData ? (
            <InstallingState cliName="Codex CLI" progress={cliData.progress} />
          ) : step === 'opencode-installing' && cliData ? (
            <InstallingState cliName="OpenCode CLI" progress={cliData.progress} />
          ) : step === 'gh-installing' && cliData ? (
            <InstallingState cliName="GitHub CLI" progress={cliData.progress} />
          ) : step === 'claude-auth-checking' ? (
            <AuthCheckingState cliName="Claude CLI" />
          ) : step === 'codex-auth-checking' ? (
            <AuthCheckingState cliName="Codex CLI" />
          ) : step === 'opencode-auth-checking' ? (
            <AuthCheckingState cliName="OpenCode CLI" />
          ) : step === 'gh-auth-checking' ? (
            <AuthCheckingState cliName="GitHub CLI" />
          ) : step === 'claude-auth-login' ? (
            <AuthLoginState
              cliName="Claude CLI"
              terminalId={claudeLoginTerminalId}
              command={claudeLoginCommand}
              onComplete={handleClaudeLoginComplete}
            />
          ) : step === 'codex-auth-login' ? (
            <AuthLoginState
              cliName="Codex CLI"
              terminalId={codexLoginTerminalId}
              command={codexLoginCommand}
              onComplete={handleCodexLoginComplete}
            />
          ) : step === 'opencode-auth-login' ? (
            <AuthLoginState
              cliName="OpenCode CLI"
              terminalId={opencodeLoginTerminalId}
              command={opencodeLoginCommand}
              onComplete={handleOpencodeLoginComplete}
            />
          ) : step === 'gh-auth-login' ? (
            <AuthLoginState
              cliName="GitHub CLI"
              terminalId={ghLoginTerminalId}
              command={ghLoginCommand}
              onComplete={handleGhLoginComplete}
            />
          ) : cliData ? (
            cliData.installError ? (
              <ErrorState
                cliName={backendLabel[cliData.type]}
                error={cliData.installError}
                onRetry={
                  cliData.type === 'claude'
                    ? handleClaudeInstall
                    : cliData.type === 'codex'
                      ? handleCodexInstall
                      : cliData.type === 'opencode'
                        ? handleOpencodeInstall
                        : handleGhInstall
                }
              />
            ) : (
              <SetupState
                cliName={backendLabel[cliData.type]}
                versions={cliData.versions}
                selectedVersion={
                  cliData.type === 'claude'
                    ? claudeVersion
                    : cliData.type === 'codex'
                      ? codexVersion
                      : cliData.type === 'opencode'
                        ? opencodeVersion
                        : ghVersion
                }
                currentVersion={
                  (cliData.type === 'claude' && isClaudeReinstall) ||
                  (cliData.type === 'codex' && isCodexReinstall) ||
                  (cliData.type === 'opencode' && isOpencodeReinstall) ||
                  (cliData.type === 'gh' && isGhReinstall)
                    ? cliData.currentVersion
                    : null
                }
                isLoading={cliData.isVersionsLoading}
                onVersionChange={
                  cliData.type === 'claude'
                    ? setClaudeVersion
                    : cliData.type === 'codex'
                      ? setCodexVersion
                      : cliData.type === 'opencode'
                        ? setOpencodeVersion
                        : setGhVersion
                }
                onInstall={
                  cliData.type === 'claude'
                    ? handleClaudeInstall
                    : cliData.type === 'codex'
                      ? handleCodexInstall
                      : cliData.type === 'opencode'
                        ? handleOpencodeInstall
                        : handleGhInstall
                }
              />
            )
          ) : (
            <BackendSelectionState
              selectedBackends={selectedBackends}
              onToggle={handleBackendToggle}
              onContinue={handleBackendSelectionContinue}
            />
          )}

          {currentBackend && step !== 'backend-select' && step !== 'complete' && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Current AI backend: {backendLabel[currentBackend]}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface BackendSelectionStateProps {
  selectedBackends: AIBackend[]
  onToggle: (backend: AIBackend, checked: boolean) => void
  onContinue: () => void
}

function BackendSelectionState({
  selectedBackends,
  onToggle,
  onContinue,
}: BackendSelectionStateProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {AI_BACKENDS.map(backend => {
          const id = `backend-${backend}`
          const checked = selectedBackends.includes(backend)
          const label = backendLabel[backend]

          return (
            <label
              key={backend}
              htmlFor={id}
              className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-accent/40"
            >
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={value => onToggle(backend, value === true)}
              />
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">
                  Install and authenticate {label}.
                </p>
              </div>
            </label>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        You must install at least one AI backend. You can install more later in
        Settings.
      </p>
      <p className="text-xs text-muted-foreground">
        Jean installs its own copies of each CLI and won't use or modify your
        global installations.
      </p>

      <Button onClick={onContinue} className="w-full" size="lg">
        Continue
      </Button>
    </div>
  )
}

interface SuccessStateProps {
  claudeVersion: string | null | undefined
  codexVersion: string | null | undefined
  opencodeVersion: string | null | undefined
  ghVersion: string | null | undefined
  onContinue: () => void
}

function SuccessState({
  claudeVersion,
  codexVersion,
  opencodeVersion,
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
            {codexVersion && <p>Codex CLI: v{codexVersion}</p>}
            {opencodeVersion && <p>OpenCode CLI: v{opencodeVersion}</p>}
            {ghVersion && <p>GitHub CLI: v{ghVersion}</p>}
            {!claudeVersion && !codexVersion && !opencodeVersion && !ghVersion && (
              <p>Setup complete</p>
            )}
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
