import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('web connection header', () => {
  const source = readFileSync(
    `${process.cwd()}/src/components/titlebar/TitleBar.tsx`,
    'utf8'
  )

  it('does not duplicate the full-screen connection indicator', () => {
    expect(source).not.toContain('useWsConnectionStatus')
    expect(source).not.toContain('Reconnecting…')
    expect(source).not.toContain('Loader2')
    expect(source).toContain('<UnreadBell />')
  })

  it('uses the client platform for native window chrome', () => {
    expect(source).toContain('isClientMacOS')
    expect(source).toContain('isClientLinux')
    expect(source).not.toContain('native && isMacOS')
    expect(source).not.toContain('native && isLinux')
  })

  it('shows a sticky host update control in the title bar', () => {
    expect(source).toContain('ServerUpdateIndicator')
    expect(source).toContain('pendingServerUpdate')
    expect(source).toContain('hostUpdateBadge')
  })

  it('never renders a host update as this app own update', () => {
    // `Update available` belongs to UpdateIndicator (pendingUpdateVersion).
    // Labelling a host update that way is the bug this split fixed.
    const hostIndicator = source.slice(
      source.indexOf('export function ServerUpdateIndicator'),
      source.indexOf('export function UpdateIndicator')
    )
    expect(hostIndicator).not.toContain('Update available')
    expect(hostIndicator).not.toContain('pendingUpdateVersion')
  })
})
