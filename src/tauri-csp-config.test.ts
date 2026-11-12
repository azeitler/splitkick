import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  tauriStyleSrc,
  type TauriConfig,
} from '../e2e/fixtures/tauri-csp'

/**
 * Library styles must load in the desktop app (#135). A nonce in the built
 * app's `style-src` disables `'unsafe-inline'` and blocks every `<style>`
 * injected at runtime; sonner's then put every toast off screen.
 */
describe('desktop app CSP', () => {
  const read = (path: string) =>
    readFileSync(`${process.cwd()}/${path}`, 'utf8')
  const config = JSON.parse(read('src-tauri/tauri.conf.json')) as TauriConfig
  const html = read('index.html')

  it('lets runtime-injected <style> tags load', () => {
    const styleSrc = tauriStyleSrc(config, html)
    expect(styleSrc).toContain("'unsafe-inline'")
    expect(styleSrc).not.toContain("'nonce-")
  })

  it('would block them if index.html had a <style> and Tauri added a nonce', () => {
    const withoutOptOut: TauriConfig = {
      app: {
        security: {
          ...config.app.security,
          dangerousDisableAssetCspModification: undefined,
        },
      },
    }
    expect(tauriStyleSrc(withoutOptOut, '<style>a{}</style>')).toContain(
      "'nonce-"
    )
    expect(tauriStyleSrc(withoutOptOut, '<p>no style</p>')).not.toContain(
      "'nonce-"
    )
  })
})
