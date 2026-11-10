import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('web connecting overlay', () => {
  const source = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8')
  const loadingScreenSource = readFileSync(
    `${process.cwd()}/src/components/shared/JeanLoadingScreen.tsx`,
    'utf8'
  )

  it('uses the same opaque theme background as initial loading', () => {
    // Single loading gate: preload OR (WS not ready without preloaded data)
    expect(source).toContain(
      '!wsConnected && !wsAuthError && !hasPreloadedData()'
    )
    expect(loadingScreenSource).toContain(
      'fixed inset-0 z-[70] flex items-center justify-center bg-background'
    )
    expect(loadingScreenSource).not.toContain('backdrop-blur-md')
    expect(loadingScreenSource).not.toContain('bg-background/20')
    expect(loadingScreenSource).toContain('z-[70]')
    expect(source).toContain('fixed inset-0 z-[80]')
  })

  it('uses one start skeleton for opening and reconnecting (#72)', () => {
    // index.html paints the skeleton before any script runs; App only shows
    // or hides it, for the preload and the WS fallback alike.
    expect(source).toContain(
      'const startGateClosed = isPreloading || blockOnWs'
    )
    expect(source).toContain('setAppSkeletonVisible(startGateClosed)')
    expect(source).not.toContain('<JeanLoadingScreen />')
    expect(source).toContain('connectTransport()')
    expect(source).not.toContain('Jean is loading...')
    expect(source).not.toContain('Reconnecting to Jean...')
    // In-app fallbacks show the skeleton's spinning notch, not a text.
    expect(loadingScreenSource).toContain('animate-spin')
    expect(loadingScreenSource).toMatch(/<p role="status" className="sr-only"/)
    expect(loadingScreenSource).toContain('fixed inset-0 z-[70]')
  })

  it('loads the server platform for both local and remote backends', () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*invoke<'mac' \| 'windows' \| 'linux'>\('get_server_platform'\)/
    )
  })
})
