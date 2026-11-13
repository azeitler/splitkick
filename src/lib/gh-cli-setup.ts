import { toast } from 'sonner'
import { useUIStore } from '@/store/ui-store'

function getErrorMessage(error: unknown): string {
  if (!error) return ''
  return error instanceof Error ? error.message : String(error)
}

/**
 * GitHub CLI can suggest `gh auth login` for repositories whose remotes are
 * not hosted on a known GitHub host. Those are repository eligibility errors,
 * not authentication failures.
 */
export function isUnsupportedGitHubRepoError(error: unknown): boolean {
  const lower = getErrorMessage(error).toLowerCase()
  if (!lower) return false

  return (
    lower.includes('none of the git remotes configured') ||
    lower.includes('no git remotes found') ||
    lower.includes('known github host') ||
    lower.includes('not a github repository') ||
    lower.includes('remote url is not a github repository') ||
    lower.includes('could not resolve repository') ||
    lower.includes('not a git repository')
  )
}

/**
 * Check if an error is a GitHub CLI authentication or installation error.
 *
 * Repository eligibility errors (GitLab/no remote/unknown host) are explicitly
 * excluded even if the gh stderr suggests running `gh auth login`.
 */
export function isGhAuthError(error: unknown): boolean {
  if (!error || isUnsupportedGitHubRepoError(error)) return false
  const message = getErrorMessage(error)
  const lower = message.toLowerCase()

  return (
    lower.includes('github cli not authenticated') ||
    lower.includes('gh auth login') ||
    lower.includes('not logged into any github hosts') ||
    lower.includes('you are not logged into any github hosts') ||
    lower.includes('requires authentication') ||
    lower.includes('authentication required') ||
    lower.includes('bad credentials') ||
    lower.includes('the system cannot find the file specified') ||
    // gh missing: the backend could not start the binary at all
    lower.includes('github cli not installed') ||
    /failed to (run|execute) gh\b/.test(lower)
  )
}

export const GH_CLI_NOT_SET_UP = 'GitHub CLI is not set up'

/**
 * Open the GitHub CLI step of the setup wizard. It installs gh, or picks the
 * system gh, and runs the login. GitHub CLI is optional, so GitHub features
 * send the user here when gh is missing or not logged in.
 */
export function openGhCliSetup() {
  useUIStore.setState({
    onboardingStartStep: 'gh',
    onboardingManuallyTriggered: true,
    onboardingDismissed: false,
    onboardingOpen: true,
  })
}

/**
 * Error toast for a user-triggered GitHub action. When gh is missing or not
 * logged in, show "GitHub CLI is not set up" with a Set up action instead of
 * the raw CLI error. Otherwise show `${prefix}: ${error}`.
 */
export function toastGitHubError(
  prefix: string,
  error: unknown,
  options?: { id?: string | number }
) {
  if (isGhAuthError(error)) {
    toast.error(GH_CLI_NOT_SET_UP, {
      id: options?.id,
      description: 'Install and log in to the GitHub CLI to use this feature.',
      action: { label: 'Set up', onClick: openGhCliSetup },
    })
    return
  }
  toast.error(`${prefix}: ${error}`, { id: options?.id })
}
