import { describe, expect, it } from 'vitest'
import {
  activeClaudeAccount,
  activeClaudeAccountId,
  claudeLoginCommand,
  listClaudeAccounts,
} from './claude-accounts'

const work = { id: 'acc-work', label: 'Work', config_dir: '/u/.claude-work' }

describe('claude-accounts', () => {
  it('lists the root install first with its label', () => {
    const accounts = listClaudeAccounts({
      claude_root_label: 'Personal',
      claude_accounts: [work],
      claude_active_account: 'acc-work',
    })
    expect(accounts.map(a => [a.id, a.label, a.configDir, a.isActive])).toEqual(
      [
        ['root', 'Personal', null, false],
        ['acc-work', 'Work', '/u/.claude-work', true],
      ]
    )
  })

  it('falls back to the root install for an unknown active id', () => {
    expect(activeClaudeAccountId({ claude_active_account: 'gone' })).toBe(
      'root'
    )
    expect(activeClaudeAccount(undefined).label).toBe('Default')
  })

  it('logs a non-root account in through env CLAUDE_CONFIG_DIR', () => {
    expect(claudeLoginCommand('/bin/claude', ['auth', 'login'], null)).toEqual({
      command: '/bin/claude',
      args: ['auth', 'login'],
    })
    expect(
      claudeLoginCommand('/bin/claude', ['auth', 'login'], '/u/.claude-work')
    ).toEqual({
      command: 'env',
      args: [
        'CLAUDE_CONFIG_DIR=/u/.claude-work',
        '/bin/claude',
        'auth',
        'login',
      ],
    })
  })
})
