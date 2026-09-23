import { describe, expect, it } from 'vitest'
import { hostUpdateBadge, hostUpdateLabel } from './host-update-badge'
import type { PendingServerUpdate } from '@/store/ui-store'

const base: PendingServerUpdate = {
  latestVersion: '0.1.73-z.15',
  currentVersion: '0.1.73-z.13',
  canUpdate: true,
  reason: null,
  channel: 'desktop',
  hostInstallPhase: 'idle',
  hostInstallMessage: null,
}

describe('hostUpdateBadge', () => {
  it('names the host, not this app, for a desktop host', () => {
    const badge = hostUpdateBadge(base)
    expect(badge.label).toBe('Host update')
    expect(badge.label).not.toBe('Update available')
    expect(badge.tooltip).toContain('the host Jean app')
    expect(badge.tooltip).toContain('v0.1.73-z.15')
    expect(badge.tooltip).toContain('0.1.73-z.13')
    expect(badge.busy).toBe(false)
  })

  it('keeps the jean-server wording on the server channel', () => {
    const badge = hostUpdateBadge({ ...base, channel: 'server' })
    expect(badge.label).toBe('Server update')
    expect(badge.tooltip).toContain('jean-server')
  })

  it('disables the control while the host downloads', () => {
    for (const phase of ['requested', 'downloading'] as const) {
      const badge = hostUpdateBadge({ ...base, hostInstallPhase: phase })
      expect(badge.label).toBe('Updating host…')
      expect(badge.busy).toBe(true)
    }
  })

  it('asks for the restart here once the host finished installing', () => {
    const badge = hostUpdateBadge({ ...base, hostInstallPhase: 'ready' })
    expect(badge.label).toBe('Restart host')
    expect(badge.busy).toBe(false)
    expect(badge.tooltip).toContain('Restart it to apply')
  })

  it('surfaces the host failure reason', () => {
    const badge = hostUpdateBadge({
      ...base,
      hostInstallPhase: 'failed',
      hostInstallMessage: 'signature mismatch',
    })
    expect(badge.label).toBe('Host update failed')
    expect(badge.tooltip).toContain('signature mismatch')
  })

  it('explains a host that cannot self-update', () => {
    const badge = hostUpdateBadge({
      ...base,
      channel: 'server',
      canUpdate: false,
      reason: 'Running in a container',
    })
    expect(badge.tooltip).toContain('Running in a container')
  })

  it('labels the update target per channel', () => {
    expect(hostUpdateLabel('desktop')).toBe('the host Jean app')
    expect(hostUpdateLabel('server')).toBe('jean-server')
  })
})
