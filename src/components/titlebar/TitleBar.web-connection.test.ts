import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

// The desktop chrome: toolbar, sidebar footer, and the update indicators the
// footer shows. The phone bar (TitleBar.tsx) carries none of this.
const toolbar = read('src/components/toolbar/WindowToolbar.tsx')
const footer = read('src/components/sidebar/SidebarFooter.tsx')
const indicators = read('src/components/titlebar/update-indicators.tsx')
const chrome = [toolbar, footer, indicators].join('\n')

describe('web connection header', () => {
  it('does not duplicate the full-screen connection indicator', () => {
    expect(chrome).not.toContain('useWsConnectionStatus')
    expect(chrome).not.toContain('Reconnecting…')
    expect(chrome).not.toContain('Loader2')
    expect(footer).toContain('<UnreadBell />')
    // Zen hides the sidebar, so the toolbar carries the bell there.
    expect(toolbar).toContain('<UnreadBell />')
  })

  it('uses the client platform for native window chrome', () => {
    expect(toolbar).toContain('isClientMacOS')
    expect(toolbar).toContain('isClientLinux')
    expect(chrome).not.toContain('native && isMacOS')
    expect(chrome).not.toContain('native && isLinux')
  })

  it('shows a sticky host update control in the sidebar footer', () => {
    expect(footer).toContain('ServerUpdateIndicator')
    expect(indicators).toContain('pendingServerUpdate')
    expect(indicators).toContain('hostUpdateBadge')
  })

  it('never renders a host update as this app own update', () => {
    // `Update available` belongs to UpdateIndicator (pendingUpdateVersion).
    // Labelling a host update that way is the bug this split fixed.
    const hostIndicator = indicators.slice(
      indicators.indexOf('export function ServerUpdateIndicator'),
      indicators.indexOf('export function UpdateIndicator')
    )
    expect(hostIndicator).not.toContain('Update available')
    expect(hostIndicator).not.toContain('pendingUpdateVersion')
  })
})
