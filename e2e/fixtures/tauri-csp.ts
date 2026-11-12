/**
 * The `style-src` the built desktop app enforces (#135).
 *
 * Tauri puts a nonce on every `<style>` tag of the HTML and adds that nonce
 * to `style-src`, unless `app.security.dangerousDisableAssetCspModification`
 * is `true` or lists `style-src` (tauri-utils `html.rs`,
 * `inject_nonce_token`). Browsers ignore `'unsafe-inline'` once a nonce is
 * in the directive, so every `<style>` a library injects at runtime (sonner,
 * react-remove-scroll, react-zoom-pan-pinch) is blocked. In 1.5.9–1.5.14
 * that put every toast off screen: index.html had gained its first `<style>`
 * (the start skeleton, #72).
 *
 * The e2e mock app has no CSP, so tests apply this one to see what the
 * desktop app sees.
 */
export interface TauriConfig {
  app: {
    security: {
      csp?: string
      dangerousDisableAssetCspModification?: boolean | string[]
    }
  }
}

export const E2E_STYLE_NONCE = 'e2e-tauri-style-nonce'

function canModify(
  setting: boolean | string[] | undefined,
  directive: string
): boolean {
  if (setting === undefined) return true
  if (typeof setting === 'boolean') return !setting
  return !setting.includes(directive)
}

/** The `style-src` value of the built app, or null when the config has none. */
export function tauriStyleSrc(config: TauriConfig, html: string): string | null {
  const { csp, dangerousDisableAssetCspModification } = config.app.security
  const styleSrc = csp
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('style-src '))
  if (!styleSrc) return null
  const hasStyleTag = /<style[\s>]/i.test(html)
  if (hasStyleTag && canModify(dangerousDisableAssetCspModification, 'style-src')) {
    return `${styleSrc} 'nonce-${E2E_STYLE_NONCE}'`
  }
  return styleSrc
}
