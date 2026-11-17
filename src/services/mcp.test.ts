import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildMcpConfigJson,
  getNewServersToAutoEnable,
  resolveEnabledMcpServers,
  resolveMcpConfigForSend,
  mcpKey,
} from './mcp'
import type { McpServerInfo } from '@/types/chat'
import sharedCases from './mcp-resolution-cases.json'

const invokeMock = vi.fn()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/lib/query-client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}))

vi.mock('@/services/projects', () => ({
  isTauri: () => true,
}))

const jeanServer: McpServerInfo = {
  name: 'jean',
  backend: 'claude',
  scope: 'user',
  disabled: false,
  config: {
    type: 'stdio',
    command: 'jean',
    args: ['--jean-mcp-stdio'],
  },
}

const otherServer: McpServerInfo = {
  name: 'github',
  backend: 'claude',
  scope: 'user',
  disabled: false,
  config: { type: 'stdio', command: 'github-mcp' },
}

describe('resolveEnabledMcpServers', () => {
  it('cascades session → project → global and auto-enables new servers', () => {
    const enabled = resolveEnabledMcpServers({
      availableServers: [jeanServer, otherServer],
      globalEnabled: [],
      knownServers: [],
    })
    expect(enabled).toEqual(
      expect.arrayContaining([mcpKey('claude', 'jean'), mcpKey('claude', 'github')])
    )
  })

  it('respects session override and skips auto-enable', () => {
    const enabled = resolveEnabledMcpServers({
      availableServers: [jeanServer, otherServer],
      sessionEnabled: [mcpKey('claude', 'github')],
      globalEnabled: [],
      knownServers: [],
    })
    expect(enabled).toEqual([mcpKey('claude', 'github')])
    expect(enabled).not.toContain(mcpKey('claude', 'jean'))
  })

  it('does not re-enable known-but-disabled servers', () => {
    const enabled = resolveEnabledMcpServers({
      availableServers: [jeanServer, otherServer],
      globalEnabled: [],
      knownServers: [mcpKey('claude', 'jean')],
    })
    expect(enabled).toEqual([mcpKey('claude', 'github')])
  })

  it('keeps configured Antigravity servers active because agy loads them automatically', () => {
    const antigravityServer: McpServerInfo = {
      ...jeanServer,
      backend: 'antigravity',
    }
    const enabled = resolveEnabledMcpServers({
      availableServers: [antigravityServer],
      sessionEnabled: [],
      globalEnabled: [],
      knownServers: [mcpKey('antigravity', 'jean')],
    })

    expect(enabled).toEqual([mcpKey('antigravity', 'jean')])
  })
})

describe('getNewServersToAutoEnable', () => {
  it('skips disabled servers', () => {
    const disabled: McpServerInfo = { ...jeanServer, disabled: true }
    expect(
      getNewServersToAutoEnable([disabled], [], [])
    ).toEqual([])
  })
})

describe('buildMcpConfigJson', () => {
  it('includes only matching backend servers', () => {
    const json = buildMcpConfigJson(
      [jeanServer, { ...otherServer, backend: 'grok', name: 'jean' }],
      [mcpKey('claude', 'jean'), mcpKey('grok', 'jean')],
      'claude'
    )
    expect(json).toBeDefined()
    if (!json) throw new Error('expected MCP config JSON')
    const parsed = JSON.parse(json)
    expect(Object.keys(parsed.mcpServers)).toEqual(['jean'])
    expect(parsed.mcpServers.jean.command).toBe('jean')
  })
})

describe('resolveMcpConfigForSend', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('discovers servers and builds mcpConfig for the first magic send', async () => {
    invokeMock.mockResolvedValue([jeanServer, otherServer])

    const result = await resolveMcpConfigForSend({
      worktreePath: '/repo/wt',
      backend: 'claude',
      globalEnabled: [],
      knownServers: [],
    })

    expect(invokeMock).toHaveBeenCalledWith('get_mcp_servers', {
      backend: 'claude',
      worktreePath: '/repo/wt',
    })
    expect(result.enabledServers).toEqual(
      expect.arrayContaining([mcpKey('claude', 'jean')])
    )
    expect(result.mcpConfig).toContain('jean')
    expect(result.mcpConfig).toContain('github')
  })

  it('returns empty config gracefully when discovery fails', async () => {
    invokeMock.mockRejectedValue(new Error('offline'))

    const result = await resolveMcpConfigForSend({
      worktreePath: '/repo/wt',
      backend: 'claude',
    })

    expect(result.enabledServers).toEqual([])
    expect(result.mcpConfig).toBeUndefined()
  })
})

// The same cases run in Rust (`jean-core/src/chat/mcp_resolve.rs`), which
// builds the config for sends without one (#103). Both must agree.
describe('shared MCP resolution cases (frontend and backend)', () => {
  interface SharedCase {
    name: string
    backend: string
    availableServers: {
      name: string
      backend: string
      disabled?: boolean
      config: Record<string, unknown>
    }[]
    sessionEnabled?: string[]
    projectEnabled?: string[]
    globalEnabled?: string[]
    knownServers?: string[]
    expectedEnabled: string[]
    expectedConfig: Record<string, unknown> | null
  }

  it.each((sharedCases as SharedCase[]).map(c => [c.name, c] as const))(
    '%s',
    (_name, c) => {
      const available: McpServerInfo[] = c.availableServers.map(s => ({
        name: s.name,
        backend: s.backend,
        config: s.config,
        scope: 'user',
        disabled: s.disabled ?? false,
      }))
      const enabled = resolveEnabledMcpServers({
        availableServers: available,
        sessionEnabled: c.sessionEnabled,
        projectEnabled: c.projectEnabled,
        globalEnabled: c.globalEnabled,
        knownServers: c.knownServers,
      })
      expect(enabled).toEqual(c.expectedEnabled)
      const json = buildMcpConfigJson(available, enabled, c.backend)
      expect(json ? JSON.parse(json) : null).toEqual(c.expectedConfig)
    }
  )
})
