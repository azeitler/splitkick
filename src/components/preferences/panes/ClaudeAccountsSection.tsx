import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsSection } from '@/components/preferences/SettingsSection'
import {
  claudeCliQueryKeys,
  useClaudeAccountAuth,
  useClaudeCliStatus,
} from '@/services/claude-cli'
import { usePatchPreferences, usePreferences } from '@/services/preferences'
import { useUIStore } from '@/store/ui-store'
import { loginArgsForBackend } from '@/lib/cli-auth'
import {
  ROOT_CLAUDE_ACCOUNT_DEFAULT_LABEL,
  ROOT_CLAUDE_ACCOUNT_ID,
  claudeLoginCommand,
  listClaudeAccounts,
  newClaudeAccountId,
  type ClaudeAccountView,
} from '@/lib/claude-accounts'
import { isLocalBackend, isNativeApp } from '@/lib/environment'
import { isWindows } from '@/lib/platform'
import type { ClaudeAccount } from '@/types/preferences'

/**
 * Settings → Claude → Accounts (#90): label the root install, add more
 * accounts (one Claude config folder each), choose the active one, and log in
 * per account.
 */
export function ClaudeAccountsSection() {
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()
  const queryClient = useQueryClient()
  const accounts = listClaudeAccounts(preferences)
  const extraAccounts = preferences?.claude_accounts ?? []
  const [newLabel, setNewLabel] = useState('')
  const [newFolder, setNewFolder] = useState('')

  const saveAccounts = useCallback(
    (patch: {
      claude_accounts?: ClaudeAccount[]
      claude_active_account?: string | null
      claude_root_label?: string | null
    }) => {
      patchPreferences.mutate(patch, {
        onSuccess: () => {
          // The active account decides what "Claude is logged in" means.
          queryClient.invalidateQueries({ queryKey: claudeCliQueryKeys.all })
        },
      })
    },
    [patchPreferences, queryClient]
  )

  const handleAdd = useCallback(() => {
    const configDir = newFolder.trim()
    if (!configDir) {
      toast.error('Choose a folder for the account')
      return
    }
    const label = newLabel.trim() || configDir.split(/[/\\]/).pop() || 'Account'
    saveAccounts({
      claude_accounts: [
        ...extraAccounts,
        { id: newClaudeAccountId(), label, config_dir: configDir },
      ],
    })
    setNewLabel('')
    setNewFolder('')
  }, [extraAccounts, newFolder, newLabel, saveAccounts])

  const handleBrowse = useCallback(async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select a Claude config folder',
    })
    if (typeof selected === 'string') setNewFolder(selected)
  }, [])

  const handleRename = useCallback(
    (account: ClaudeAccountView, label: string) => {
      const trimmed = label.trim()
      if (account.isRoot) {
        if ((preferences?.claude_root_label ?? '') === trimmed) return
        saveAccounts({ claude_root_label: trimmed || null })
        return
      }
      if (!trimmed || trimmed === account.label) return
      saveAccounts({
        claude_accounts: extraAccounts.map(a =>
          a.id === account.id ? { ...a, label: trimmed } : a
        ),
      })
    },
    [extraAccounts, preferences?.claude_root_label, saveAccounts]
  )

  const handleRemove = useCallback(
    (account: ClaudeAccountView) => {
      saveAccounts({
        claude_accounts: extraAccounts.filter(a => a.id !== account.id),
        ...(account.isActive ? { claude_active_account: null } : {}),
      })
      toast.success(
        `Removed ${account.label}. Its folder and login stay on disk.`
      )
    },
    [extraAccounts, saveAccounts]
  )

  const handleActivate = useCallback(
    (account: ClaudeAccountView) => {
      saveAccounts({
        claude_active_account: account.isRoot ? null : account.id,
      })
    },
    [saveAccounts]
  )

  const canBrowse = isNativeApp() && isLocalBackend()

  return (
    <SettingsSection
      title="Accounts"
      anchorId="pref-claude-section-accounts"
      variant="card"
      description={
        <>
          Each account is its own Claude config folder (
          <code>CLAUDE_CONFIG_DIR</code>). Every Claude run uses the active
          account, also in open and old sessions: a switch takes effect on the
          next send, a running turn finishes on its account. MCP servers,
          plugins, skills and settings are separate per folder.
        </>
      }
    >
      <ol
        className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground"
        data-testid="claude-accounts-setup"
      >
        <li>
          Enter a label and a new folder below, for example{' '}
          <code>~/.claude-work</code>, and click Add account. Splitkick makes
          the folder if it does not exist.
        </li>
        <li>
          Click Login on the new row and sign in with the other Claude account.
          The login is kept in that folder, so each account stays logged in.
          {isWindows ? (
            <>
              {' '}
              On Windows, log in from a terminal with{' '}
              <code>CLAUDE_CONFIG_DIR</code> set to the folder, then run{' '}
              <code>claude</code>.
            </>
          ) : null}
        </li>
        <li>
          Click Make active. New sessions use this account; open sessions keep
          their account.
        </li>
        <li>
          A new folder starts empty. MCP servers, plugins, skills,{' '}
          <code>CLAUDE.md</code> and settings from <code>~/.claude</code> are
          not copied. Add them again, or copy or link the files you want to
          share.
        </li>
        <li>
          A <code>claude</code> you start in a terminal still uses{' '}
          <code>~/.claude</code>, unless you set <code>CLAUDE_CONFIG_DIR</code>{' '}
          there too.
        </li>
      </ol>
      <div className="space-y-2" data-testid="claude-accounts">
        {accounts.map(account => (
          <ClaudeAccountRow
            key={account.id}
            account={account}
            onRename={handleRename}
            onRemove={handleRemove}
            onActivate={handleActivate}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
        <Input
          aria-label="New account label"
          placeholder="Label, e.g. Work"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          className="h-8 w-40"
        />
        <Input
          aria-label="New account folder"
          placeholder="Folder, e.g. ~/.claude-work"
          value={newFolder}
          onChange={e => setNewFolder(e.target.value)}
          className="h-8 min-w-48 flex-1 font-mono text-xs"
        />
        {canBrowse ? (
          <Button size="sm" variant="outline" onClick={handleBrowse}>
            Browse
          </Button>
        ) : null}
        <Button size="sm" onClick={handleAdd} disabled={!newFolder.trim()}>
          Add account
        </Button>
      </div>
    </SettingsSection>
  )
}

function ClaudeAccountRow({
  account,
  onRename,
  onRemove,
  onActivate,
}: {
  account: ClaudeAccountView
  onRename: (account: ClaudeAccountView, label: string) => void
  onRemove: (account: ClaudeAccountView) => void
  onActivate: (account: ClaudeAccountView) => void
}) {
  const { data: cliStatus } = useClaudeCliStatus()
  const auth = useClaudeAccountAuth(account.id, {
    enabled: !!cliStatus?.installed,
  })
  const openCliLoginModal = useUIStore(state => state.openCliLoginModal)
  const [label, setLabel] = useState(
    account.isRoot && account.label === ROOT_CLAUDE_ACCOUNT_DEFAULT_LABEL
      ? ''
      : account.label
  )

  // Login runs `env CLAUDE_CONFIG_DIR=…`, which Windows does not have.
  const loginSupported = !!cliStatus?.path && (account.isRoot || !isWindows)

  const handleLogin = useCallback(() => {
    if (!cliStatus?.path) return
    const { command, args } = claudeLoginCommand(
      cliStatus.path,
      loginArgsForBackend('claude', cliStatus.supports_auth_command),
      account.configDir
    )
    openCliLoginModal('claude', command, args)
  }, [
    account.configDir,
    cliStatus?.path,
    cliStatus?.supports_auth_command,
    openCliLoginModal,
  ])

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
      data-testid={`claude-account-${account.id}`}
    >
      <Input
        aria-label={`Label for ${account.isRoot ? 'the root install' : account.label}`}
        value={label}
        placeholder={account.isRoot ? ROOT_CLAUDE_ACCOUNT_DEFAULT_LABEL : ''}
        onChange={e => setLabel(e.target.value)}
        onBlur={() => onRename(account, label)}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="h-8 w-40"
      />
      <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {account.configDir ?? '~/.claude (root install)'}
      </code>
      <span className="text-xs text-muted-foreground">
        {!cliStatus?.installed ? (
          'CLI not installed'
        ) : auth.isLoading ? (
          <Loader2 className="size-3 animate-spin" />
        ) : auth.data?.authenticated ? (
          'Logged in'
        ) : (
          'Not logged in'
        )}
      </span>
      {loginSupported ? (
        <Button size="sm" variant="outline" onClick={handleLogin}>
          {auth.data?.authenticated ? 'Relogin' : 'Login'}
        </Button>
      ) : null}
      {account.isActive ? (
        <span className="rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
          Active
        </span>
      ) : (
        <Button size="sm" variant="outline" onClick={() => onActivate(account)}>
          Make active
        </Button>
      )}
      {account.id !== ROOT_CLAUDE_ACCOUNT_ID ? (
        <Button size="sm" variant="ghost" onClick={() => onRemove(account)}>
          Remove
        </Button>
      ) : null}
    </div>
  )
}
