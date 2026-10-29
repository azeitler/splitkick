import { useInstalledApps } from '@/services/projects'
import { usePreferences } from '@/services/preferences'
import { isLocalBackend } from '@/lib/environment'
import { resolveGitClient, type GitClientApp } from '@/types/preferences'

/**
 * The git client that "Open in" uses, or null when none is installed.
 * Local backend only: a remote worktree path does not exist on this Mac.
 */
export function useGitClient(): GitClientApp | null {
  const { data: preferences } = usePreferences()
  const { data: installed } = useInstalledApps()
  if (!isLocalBackend()) return null
  return resolveGitClient(preferences?.git_client, installed)
}
