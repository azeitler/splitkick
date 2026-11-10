/**
 * Several Claude accounts (#90). The root install (`~/.claude`) is always
 * there; every other account is its own Claude config folder, passed to the
 * CLI as `CLAUDE_CONFIG_DIR`. See docs/developer/claude-accounts.md.
 */
import type { AppPreferences } from '@/types/preferences'

export const ROOT_CLAUDE_ACCOUNT_ID = 'root'
export const ROOT_CLAUDE_ACCOUNT_DEFAULT_LABEL = 'Default'

export interface ClaudeAccountView {
  id: string
  label: string
  /** Null for the root install (`~/.claude`). */
  configDir: string | null
  isRoot: boolean
  isActive: boolean
}

type AccountPrefs = Pick<
  AppPreferences,
  'claude_root_label' | 'claude_accounts' | 'claude_active_account'
>

export function rootClaudeAccountLabel(prefs?: Partial<AccountPrefs>): string {
  return prefs?.claude_root_label?.trim() || ROOT_CLAUDE_ACCOUNT_DEFAULT_LABEL
}

/** Id of the account new Claude runs use. Mirrors the backend: unknown ids fall back to root. */
export function activeClaudeAccountId(prefs?: Partial<AccountPrefs>): string {
  const active = prefs?.claude_active_account
  if (active && (prefs?.claude_accounts ?? []).some(a => a.id === active)) {
    return active
  }
  return ROOT_CLAUDE_ACCOUNT_ID
}

/** Root first, then the extra accounts in settings order. */
export function listClaudeAccounts(
  prefs?: Partial<AccountPrefs>
): ClaudeAccountView[] {
  const activeId = activeClaudeAccountId(prefs)
  return [
    {
      id: ROOT_CLAUDE_ACCOUNT_ID,
      label: rootClaudeAccountLabel(prefs),
      configDir: null,
      isRoot: true,
      isActive: activeId === ROOT_CLAUDE_ACCOUNT_ID,
    },
    ...(prefs?.claude_accounts ?? []).map(account => ({
      id: account.id,
      label: account.label,
      configDir: account.config_dir,
      isRoot: false,
      isActive: account.id === activeId,
    })),
  ]
}

export function activeClaudeAccount(
  prefs?: Partial<AccountPrefs>
): ClaudeAccountView {
  const accounts = listClaudeAccounts(prefs)
  return accounts.find(a => a.isActive) ?? (accounts[0] as ClaudeAccountView)
}

/**
 * Label of the active account, the one every Claude run uses (#131), for the
 * model chip. Null with only the root install: nothing to tell apart.
 */
export function activeClaudeAccountTag(
  prefs?: Partial<AccountPrefs>
): string | null {
  if (!prefs?.claude_accounts?.length) return null
  return activeClaudeAccount(prefs).label
}

/**
 * Label of a configured account by id, e.g. the account of the run that hit
 * a limit. Null with only the root install, or for an unknown id.
 */
export function claudeAccountLabel(
  prefs: Partial<AccountPrefs> | undefined,
  accountId: string | null | undefined
): string | null {
  if (!accountId || !prefs?.claude_accounts?.length) return null
  return listClaudeAccounts(prefs).find(a => a.id === accountId)?.label ?? null
}

/**
 * Terminal command for a Claude login. A non-root account runs through
 * `env CLAUDE_CONFIG_DIR=<dir>` so the login lands in that folder; the root
 * install runs the CLI as it is.
 */
export function claudeLoginCommand(
  cliPath: string,
  args: string[],
  configDir: string | null
): { command: string; args: string[] } {
  if (!configDir) return { command: cliPath, args }
  return {
    command: 'env',
    args: [`CLAUDE_CONFIG_DIR=${configDir}`, cliPath, ...args],
  }
}

export function newClaudeAccountId(): string {
  return `acc-${crypto.randomUUID()}`
}
