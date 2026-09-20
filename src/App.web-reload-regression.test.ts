import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('web access disconnect recovery', () => {
  const source = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8')

  it('recovers in place instead of reloading the web app', () => {
    // A mobile browser drops the socket every time it suspends a background
    // tab. Reloading there would discard the composer draft, the scroll
    // position and every open modal whenever the user switches app.
    expect(source).toContain(
      "logger.info('WebSocket disconnected, reconnecting web app in place')"
    )
    expect(source).toContain('onEstablishedWsDisconnect(() =>')
    expect(source).not.toMatch(
      /onEstablishedWsDisconnect\(\(\) => \{[\s\S]*?window\.location\.reload\(\)/
    )
    // The captured modal state still covers a manual or stale-version reload.
    expect(source).toContain('captureWebReloadState()')
    expect(source).toContain('<JeanLoadingScreen />')
    // Preload path may also mount QuitConfirmationDialog so X/quit still works
    expect(source).toContain('QuitConfirmationDialog')
    expect(source).not.toContain('WebReloadingOverlay')
  })

  it('re-runs the bootstrap after a reconnect so missed events replay', () => {
    expect(source).toContain('refetchBootstrapData(')
    expect(source).toMatch(
      /wsWasConnectedRef\.current\) \{[\s\S]*?refetchBootstrapData\([\s\S]*?ingestBootstrapEvents\(/
    )
    // Everything is refetched, which is the in-memory equivalent of the reload.
    expect(source).toMatch(
      /wsWasConnectedRef\.current\) \{[\s\S]*?queryClient\.invalidateQueries\(\)/
    )
    // A server that shipped new frontend code still prompts for a real reload.
    expect(source).toMatch(
      /refetchBootstrapData\([\s\S]*?checkWebClientVersion\(data\)/
    )
  })

  it('dismisses stuck overlays on native remote disconnect', () => {
    // Native remote keeps the shell + its RemoteConnectionRecovery UI.
    expect(source).toContain('dismissTransientUi()')
    expect(source).toMatch(/if \(isNativeApp\(\)\) \{\s*dismissTransientUi\(\)/)
    // Must not skip the disconnect listener entirely for native clients.
    expect(source).not.toMatch(/if \(!webBackend \|\| isNativeApp\(\)\) return/)
  })
})
