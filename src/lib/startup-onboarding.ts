interface CliStatus {
  installed: boolean
}

interface CliAuthStatus {
  authenticated: boolean
}

interface StartupOnboardingState {
  /** AI backend CLI install statuses (any length; one entry per backend). */
  aiStatuses: (CliStatus | undefined)[]
  /** Matching auth statuses for each AI backend (same order as aiStatuses). */
  aiAuth: (CliAuthStatus | undefined)[]
  onboardingOpen: boolean
  onboardingDismissed: boolean
  onboardingManuallyTriggered: boolean
  /**
   * The user has moved past the first setup screen. The dialog then finishes
   * on its own "Setup complete" step instead of vanishing mid-flow.
   */
  onboardingEngaged?: boolean
  /**
   * Local Windows still needs a WSL vs native choice. Must be false for remote
   * connections — WSL only applies to the local desktop shell. It never
   * blocks a ready setup; the wizard asks for it when the user installs.
   */
  requiresWslChoice: boolean
}

export type StartupOnboardingAction =
  | 'wait'
  | 'open'
  | 'close'
  | 'ready'
  | 'none'

function isReady(
  status: CliStatus | undefined,
  auth: CliAuthStatus | undefined
): boolean {
  return !!status?.installed && !!auth?.authenticated
}

export function getStartupOnboardingAction({
  aiStatuses,
  aiAuth,
  onboardingOpen,
  onboardingDismissed,
  onboardingManuallyTriggered,
  onboardingEngaged = false,
}: StartupOnboardingState): StartupOnboardingAction {
  if (onboardingDismissed || onboardingManuallyTriggered) return 'none'

  // Wait until every status query has resolved (undefined = still loading).
  if (aiStatuses.some(status => status === undefined)) return 'wait'

  // Wait for auth of installed tools only.
  const aiAuthPending = aiStatuses.some(
    (status, index) => status?.installed && aiAuth[index] === undefined
  )
  if (aiAuthPending) return 'wait'

  // Any authenticated AI backend counts (Claude, Codex, Grok, Pi, …).
  const hasAiBackendReady = aiStatuses.some((status, index) =>
    isReady(status, aiAuth[index])
  )

  // One ready AI backend is enough. GitHub CLI is optional: GitHub features
  // show their own "not set up" state. Never force the setup wizard
  // (including the "Setup Complete" success screen). WSL choice can wait
  // until the user actually needs local CLI installs.
  if (hasAiBackendReady) {
    if (!onboardingOpen) return 'ready'
    return onboardingEngaged ? 'none' : 'close'
  }

  return 'open'
}
