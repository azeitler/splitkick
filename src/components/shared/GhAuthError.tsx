import { LogIn, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GH_CLI_NOT_SET_UP, openGhCliSetup } from '@/lib/gh-cli-setup'
import { useGhLogin } from '@/hooks/useGhLogin'

interface GhAuthErrorProps {
  onLogin: () => void
  isGhInstalled: boolean
}

/**
 * Shared component displayed when a GitHub CLI command fails due to
 * missing authentication or missing installation. GitHub CLI is optional,
 * so this is a normal state, not an error.
 */
export function GhAuthError({ onLogin, isGhInstalled }: GhAuthErrorProps) {
  const Icon = isGhInstalled ? LogIn : Download
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-3">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {GH_CLI_NOT_SET_UP}
        </p>
        <p className="text-xs text-muted-foreground">
          {isGhInstalled
            ? 'Sign in to GitHub to use issues, pull requests and Actions.'
            : 'Install the GitHub CLI to use issues, pull requests and Actions.'}
        </p>
      </div>
      {isGhInstalled ? (
        <Button variant="outline" size="sm" onClick={onLogin}>
          Sign in to GitHub
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openGhCliSetup}>
          Set up GitHub CLI
        </Button>
      )}
    </div>
  )
}

/** `GhAuthError` wired to the gh login, for places with no login handler. */
export function GhCliNotSetUp() {
  const { triggerLogin, isGhInstalled } = useGhLogin()
  return <GhAuthError onLogin={triggerLogin} isGhInstalled={isGhInstalled} />
}
