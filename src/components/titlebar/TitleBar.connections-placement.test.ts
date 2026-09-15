import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('TitleBar connection placement', () => {
  it('does not show the Connections button', () => {
    const source = readFileSync('src/components/titlebar/TitleBar.tsx', 'utf8')

    expect(source).not.toContain('RemoteConnectionsDialog')
  })

  it('shows a reconnect control beside a selected remote server', () => {
    const source = readFileSync('src/components/titlebar/TitleBar.tsx', 'utf8')

    expect(source).toContain('<RemoteServerRefreshButton')
    expect(source).toContain('serverId={serverContext.serverId}')
  })
})
